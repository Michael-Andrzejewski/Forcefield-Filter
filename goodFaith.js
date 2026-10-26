// goodFaith.js — judges X accounts by good faith and mutes the ones that keep
// arguing in bad faith. Loaded by the service worker (importScripts, after
// llm.js) and the popup (<script>). Plain functions over plain objects: the
// background owns the storage, and tests call these directly.
//
// - Every scan on X also asks which flagged posts are written in bad faith
//   (FAITH_INSTRUCTIONS in llm.js for text models, a second score question
//   for Jev).
// - Each bad-faith post counts against its author in the ledger (local
//   `badFaithLedger`, keyed by lower-case "@handle").
// - Two bad-faith posts within 30 days mute the account for 1 hour. After
//   that, every new bad-faith post seen once a mute has ended mutes it again
//   for twice as long: 1h, 2h, 4h, 8h, then 1 day, 2 days, 4 days, 8 days...
// - Accounts the user follows are muted for 7 days at most.
// - Temporary mute, the user's own pick from a post's menu (twitterTracker.js
//   adds it next to X's Mute): 7 days, or 30 days when picked again before 30
//   days have passed since the last one ended. No cap for followed accounts.
//   It works even with the bad-faith mutes switched off.
// - Liking one of their posts ends a mute. For bad-faith mutes it also resets
//   the ladder; a temporary mute just ends there. There is no unmute button
//   on purpose.
// A mute only boxes their posts in this browser, like a block. It never
// mutes the account on X.

const GOOD_FAITH_FIRST_MUTE_POSTS = 2;
const GOOD_FAITH_WINDOW_MS = 30 * 24 * 3600 * 1000; // bad-faith posts older than this stop counting toward a first mute
const FOLLOWED_MUTE_CAP_MS = 7 * 24 * 3600 * 1000;
const TEMP_MUTE_MS = 7 * 24 * 3600 * 1000;
const TEMP_MUTE_REPEAT_MS = 30 * 24 * 3600 * 1000;
const TEMP_MUTE_REPEAT_WINDOW_MS = 30 * 24 * 3600 * 1000; // after a temporary mute ends
const GOOD_FAITH_MAX_ACCOUNTS = 3000;
const GOOD_FAITH_KEYS_PER_ACCOUNT = 50;
const GOOD_FAITH_MIN_PHRASE = 12; // shorter tagged phrases are too common to pin on one tweet
const HOUR_MS = 3600 * 1000;

// Length of the nth mute (1-based): 1h, 2h, 4h, 8h, then 1 day doubling.
function muteDurationMs(n) {
    if (n <= 4) return HOUR_MS * Math.pow(2, Math.max(0, n - 1));
    return 24 * HOUR_MS * Math.pow(2, n - 5);
}

// "@Some_One", "Some_One" -> "@some_one"; anything else -> ''.
function normalizeHandle(h) {
    const m = /^@?([A-Za-z0-9_]{1,50})$/.exec(String(h || '').trim());
    return m ? '@' + m[1].toLowerCase() : '';
}

// The blocker's text folding (see tweetScanKey in llm.js), without the cap.
function faithMatchText(text) {
    return String(text || '')
        .replace(/[‘’`´]/g, "'")
        .replace(/[“”„«»]/g, '"')
        .replace(/[–—―−]/g, '-')
        .replace(/…/g, '...')
        .replace(/\s+/g, '')
        .toLowerCase();
}
function faithPostKey(text) {
    return faithMatchText(text).slice(0, 100);
}

function newLedgerEntry(now) {
    return { since: now, posts: [], keys: [], mutes: 0, mutedAt: 0, mutedUntil: 0, reasons: [], tempMutedAt: 0, tempMutedUntil: 0 };
}

// When this account's bad-faith mute ends (0 when never muted). Followed
// accounts are capped at 7 days from the start of the mute.
function autoMuteEnd(entry, followed) {
    if (!entry || !entry.mutedUntil) return 0;
    return followed ? Math.min(entry.mutedUntil, (entry.mutedAt || 0) + FOLLOWED_MUTE_CAP_MS) : entry.mutedUntil;
}
// When this account is shown again: the later of the bad-faith mute (left
// out when those are switched off) and the user's temporary mute.
function muteEnd(entry, followed, includeAuto = true) {
    if (!entry) return 0;
    return Math.max(includeAuto ? autoMuteEnd(entry, followed) : 0, entry.tempMutedUntil || 0);
}

// Which tweet each bad-faith phrase came from. phrases: strings; tweets:
// [{ text, handle }]. Returns [{ handle, text }], one per tweet. A phrase
// found in tweets by more than one account, or too short to place, is
// skipped: a wrong mute is worse than a missed one.
function attributeBadFaith(phrases, tweets) {
    const folded = (tweets || []).map(t => ({ tweet: t, norm: faithMatchText(t && t.text), handle: normalizeHandle(t && t.handle) }));
    const out = new Map();
    for (const phrase of phrases || []) {
        const p = faithMatchText(phrase);
        if (p.length < GOOD_FAITH_MIN_PHRASE) continue;
        const hits = folded.filter(f => f.handle && f.norm.includes(p));
        if (hits.length === 0 || new Set(hits.map(h => h.handle)).size > 1) continue;
        for (const h of hits) out.set(faithPostKey(h.tweet.text), { handle: h.handle, text: String(h.tweet.text) });
    }
    return [...out.values()];
}

// Counts bad-faith posts against their authors and mutes the ones that
// reached the next rung. posts: [{ handle, text }]. following: { "@h": true }.
// Returns { ledger, muted: [{ handle, n, until }] }; the ledger is a copy.
function recordBadFaithPosts(ledger, posts, { now, following, ownHandle } = {}) {
    now = now || Date.now();
    const out = JSON.parse(JSON.stringify(ledger || {}));
    const own = normalizeHandle(ownHandle);
    const muted = [];
    for (const post of posts || []) {
        const h = normalizeHandle(post && post.handle);
        if (!h || h === own) continue;
        const key = faithPostKey(post.text);
        if (!key) continue;
        const entry = out[h] || newLedgerEntry(now);
        out[h] = entry;
        if (entry.keys.includes(key)) continue; // X re-rendered a post already counted
        entry.keys = entry.keys.concat([key]).slice(-GOOD_FAITH_KEYS_PER_ACCOUNT);
        // Posts seen while muted (either kind) are already covered by the mute.
        if (muteEnd(entry, following && following[h] === true) > now) continue;
        entry.posts = entry.posts.filter(p => now - p.ts < GOOD_FAITH_WINDOW_MS)
            .concat([{ ts: now, text: String(post.text || '').slice(0, 200) }]);
        const needed = entry.mutes === 0 ? GOOD_FAITH_FIRST_MUTE_POSTS : 1;
        if (entry.posts.length >= needed) {
            entry.mutes += 1;
            entry.mutedAt = now;
            entry.mutedUntil = now + muteDurationMs(entry.mutes);
            entry.reasons = entry.posts.map(p => p.text);
            entry.posts = [];
            muted.push({ handle: h, n: entry.mutes, until: autoMuteEnd(entry, following && following[h] === true) });
        }
    }
    return { ledger: pruneLedger(out, now, following), muted };
}

// How long a temporary mute picked now would last: 30 days when the last
// one is still on or ended less than 30 days ago, else 7 days.
function tempMuteLengthMs(entry, now) {
    const lastEnd = entry && entry.tempMutedUntil;
    return lastEnd && now <= lastEnd + TEMP_MUTE_REPEAT_WINDOW_MS ? TEMP_MUTE_REPEAT_MS : TEMP_MUTE_MS;
}

// The user picked Temporary mute on one of this account's posts.
// Returns { ledger, handle, until, ms }; ledger is null (nothing to save)
// for a bad handle or the user's own. The ledger is a copy.
function tempMuteAccount(ledger, handle, { now, ownHandle } = {}) {
    now = now || Date.now();
    const h = normalizeHandle(handle);
    if (!h || h === normalizeHandle(ownHandle)) return { ledger: null, handle: h, until: 0, ms: 0 };
    const out = JSON.parse(JSON.stringify(ledger || {}));
    const entry = out[h] || newLedgerEntry(now);
    out[h] = entry;
    const ms = tempMuteLengthMs(entry, now);
    entry.tempMutedAt = now;
    entry.tempMutedUntil = now + ms;
    return { ledger: pruneLedger(out, now), handle: h, until: entry.tempMutedUntil, ms };
}

// A like on any post by an account forgives what was recorded against it
// before the like: it ends a bad-faith mute that began earlier and resets
// the ladder, drops earlier bad-faith posts, and ends a temporary mute early
// (counting as its end, so picking it again within 30 days still gives 30).
// Anything recorded after the like stays.
// liked: twitterActivity.liked entries ({ handle, ts: ISO string }).
// Returns { ledger, forgiven: ["@h"], changed }; the ledger is a copy.
function forgiveLikedAccounts(ledger, liked) {
    const out = JSON.parse(JSON.stringify(ledger || {}));
    const forgiven = new Set();
    let changed = false;
    const likes = (liked || [])
        .map(l => ({ h: normalizeHandle(l && l.handle), ts: Date.parse(l && l.ts) }))
        .filter(l => l.h && out[l.h] && isFinite(l.ts))
        .sort((a, b) => a.ts - b.ts);
    for (const { h, ts } of likes) {
        const e = out[h];
        if (ts <= e.since) continue; // older than the record, or already applied
        const posts = e.posts.filter(p => p.ts > ts);
        const unmute = e.mutes > 0 && e.mutedAt < ts;
        const endTemp = e.tempMutedAt > 0 && e.tempMutedAt < ts && e.tempMutedUntil > ts;
        if (posts.length < e.posts.length || unmute || endTemp) forgiven.add(h);
        e.posts = posts;
        // keys stay, so the posts behind the old record never count again.
        if (unmute) Object.assign(e, { mutes: 0, mutedAt: 0, mutedUntil: 0, reasons: [] });
        if (endTemp) e.tempMutedUntil = ts;
        e.since = ts;
        changed = true;
    }
    return { ledger: out, forgiven: [...forgiven], changed };
}

// Keeps the ledger bounded: past the cap, the accounts with the oldest
// activity go first, never one that is muted right now or still inside a
// temporary mute's 30-day repeat window.
function pruneLedger(ledger, now, following) {
    const handles = Object.keys(ledger);
    if (handles.length <= GOOD_FAITH_MAX_ACCOUNTS) return ledger;
    const last = e => Math.max(e.since || 0, e.mutedAt || 0, e.tempMutedAt || 0, ...(e.posts || []).map(p => p.ts));
    const removable = handles
        .filter(h => muteEnd(ledger[h], following && following[h] === true) <= now &&
            (ledger[h].tempMutedUntil || 0) + TEMP_MUTE_REPEAT_WINDOW_MS <= now)
        .sort((a, b) => last(ledger[a]) - last(ledger[b]));
    for (const h of removable.slice(0, handles.length - GOOD_FAITH_MAX_ACCOUNTS)) delete ledger[h];
    return ledger;
}

// Accounts muted right now: [{ handle, until, n, followed, temporary }].
// temporary: the user's temporary mute is the one that lasts longer.
// includeAuto false (bad-faith mutes switched off): temporary mutes only.
function activeMutes(ledger, following, now, { includeAuto = true } = {}) {
    now = now || Date.now();
    return Object.keys(ledger || {}).map(h => {
        const e = ledger[h];
        const followed = !!(following && following[h] === true);
        const autoEnd = includeAuto ? autoMuteEnd(e, followed) : 0;
        const tempEnd = e.tempMutedUntil || 0;
        return { handle: h, until: Math.max(autoEnd, tempEnd), n: e.mutes, followed, temporary: tempEnd > 0 && tempEnd >= autoEnd };
    }).filter(m => m.until > now);
}

// 40 min -> "40m", 3h 20m -> "3h 20m", 2 days 4 hours -> "2d 4h".
function formatTimeLeft(ms) {
    const mins = Math.max(1, Math.ceil(ms / 60000));
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}
// A ladder length: 1 hour, 8 hours, 1 day, 4 days.
function formatMuteLength(ms) {
    const hours = Math.round(ms / HOUR_MS);
    if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;
    const days = Math.round(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
}

// The white box text for a muted account's post.
function muteNote(m, now) {
    const left = formatTimeLeft(m.until - (now || Date.now()));
    if (m.temporary) return `Temporarily muted by you: ${m.handle} (${left} left)`;
    return `Muted by Forcefield: ${m.handle} keeps arguing in bad faith (mute ${m.n}, ${left} left)`;
}

// Popup lines, muted accounts first (longest left first), then accounts on
// their way to a bad-faith mute, then accounts whose temporary mute ended
// recently enough that picking it again gives 30 days.
function describeLedger(ledger, following, now, { includeAuto = true } = {}) {
    now = now || Date.now();
    const rows = [];
    for (const h of Object.keys(ledger || {})) {
        const e = ledger[h];
        const followed = !!(following && following[h] === true);
        const autoEnd = includeAuto ? autoMuteEnd(e, followed) : 0;
        const tempEnd = e.tempMutedUntil || 0;
        const tag = followed ? ' · you follow them (7-day cap)' : '';
        if (tempEnd > now && tempEnd >= autoEnd) {
            rows.push({ order: 0, sort: -(tempEnd - now), line: `${h} · muted by you, ${formatTimeLeft(tempEnd - now)} left (temporary mute)` });
            continue;
        }
        if (autoEnd > now) {
            rows.push({ order: 0, sort: -(autoEnd - now), line: `${h} · muted, ${formatTimeLeft(autoEnd - now)} left (mute ${e.mutes})${tag}` });
            continue;
        }
        const parts = [];
        let order = 3, sort = -tempEnd;
        if (includeAuto && e.mutes > 0) {
            const next = followed ? Math.min(muteDurationMs(e.mutes + 1), FOLLOWED_MUTE_CAP_MS) : muteDurationMs(e.mutes + 1);
            parts.push(`${e.mutes} mute${e.mutes === 1 ? '' : 's'} so far; the next bad-faith post mutes for ${formatMuteLength(next)}${tag}`);
            order = 1; sort = -e.mutedAt;
        } else if (includeAuto && e.posts.length > 0) {
            const left = GOOD_FAITH_FIRST_MUTE_POSTS - e.posts.length;
            parts.push(`${e.posts.length} bad-faith post${e.posts.length === 1 ? '' : 's'}; ${left} more within 30 days mutes for 1 hour${tag}`);
            order = 2; sort = -e.posts[e.posts.length - 1].ts;
        }
        if (tempEnd > 0 && now < tempEnd + TEMP_MUTE_REPEAT_WINDOW_MS) {
            parts.push(`a temporary mute in the next ${formatTimeLeft(tempEnd + TEMP_MUTE_REPEAT_WINDOW_MS - now)} lasts 30 days`);
        }
        if (parts.length) rows.push({ order, sort, line: `${h} · ${parts.join(' · ')}` });
    }
    return rows.sort((a, b) => a.order - b.order || a.sort - b.sort).map(r => r.line);
}

self.ForcefieldGoodFaith = {
    GOOD_FAITH_FIRST_MUTE_POSTS, GOOD_FAITH_WINDOW_MS, FOLLOWED_MUTE_CAP_MS, GOOD_FAITH_MAX_ACCOUNTS,
    TEMP_MUTE_MS, TEMP_MUTE_REPEAT_MS, TEMP_MUTE_REPEAT_WINDOW_MS,
    muteDurationMs, normalizeHandle, faithMatchText, autoMuteEnd, muteEnd, attributeBadFaith, recordBadFaithPosts,
    tempMuteLengthMs, tempMuteAccount, forgiveLikedAccounts, activeMutes, formatTimeLeft, formatMuteLength, muteNote, describeLedger
};
