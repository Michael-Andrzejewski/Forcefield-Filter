// seenPosts.js — every X post the user scrolls past, rated for good faith and
// sincerity, and an average per account that can mute the account. Loaded by
// the service worker (importScripts, after llm.js and goodFaith.js) and the
// popup (<script>). Pure functions over plain objects, plus a small store.
//
// - twitterTracker.js sends each post that is at least half on screen
//   (command `recordSeenPosts`). Switch: sync `recordSeenPosts`, on by default.
// - The background keeps them in IndexedDB (database `forcefield`, store
//   `seenPosts`), keyed by the post's status id.
// - Every minute it sends up to 5 batches of unrated posts to Haiku 5.5 (or
//   Gemini Flash-Lite when only a Gemini key is set), which rates each post
//   1-10 for good faith and 1-10 for sincerity. The spend counts toward the
//   same hourly and daily limits as scans.
// - Each account keeps its 50 most recent rated posts from the last 90 days
//   (store `accounts`). Its score is the mean of (faith + sincerity) / 2,
//   pulled toward 7 as if it had 3 more ordinary posts, so a few posts can't
//   sink an account. Local `accountScores` holds { "@h": [score, n] } for
//   accounts with at least 5 rated posts, for the page and the popup.
// - With sync `scoreMutes` on (default), an account scoring at or below sync
//   `scoreMuteThreshold` (default 4) is boxed like a good-faith mute. Never the
//   user's own account or an account they follow.
// - Liking one of their posts forgives: posts first seen before the like stop
//   counting.

const SEEN_DB_NAME = 'forcefield';
const SEEN_DB_VERSION = 1;
const SEEN_MAX_POSTS = 100000;            // oldest sightings go first past this
const SEEN_TEXT_MAX = 2000;
const RATE_BATCH_SIZE = 40;
const RATE_BATCHES_PER_RUN = 5;
const RATE_MAX_ATTEMPTS = 3;              // a post the model keeps skipping is left unrated
const ACCOUNT_RECENT_POSTS = 50;
const ACCOUNT_WINDOW_MS = 90 * 24 * 3600 * 1000;
const SCORE_MIN_POSTS = 5;
const SCORE_PRIOR_MEAN = 7;
const SCORE_PRIOR_WEIGHT = 3;
const DEFAULT_SCORE_MUTE_THRESHOLD = 4;
const SCORE_MUTE_THRESHOLD_MIN = 1;
const SCORE_MUTE_THRESHOLD_MAX = 7;

// --- Posts -----------------------------------------------------------------

// The store key for a post: its status id, else author + folded text.
function seenPostKey(p) {
    const id = p && /^\d{1,25}$/.test(String(p.id || '')) ? String(p.id) : '';
    if (id) return id;
    const h = normalizeHandle(p && p.handle);
    const t = faithMatchText(p && p.text).slice(0, 120);
    return h && t ? `${h}|${t}` : '';
}

// A post from the page -> a clean record, or null when it has no author.
// Unknown fields are dropped and strings are capped.
function cleanSeenPost(p) {
    if (!p || typeof p !== 'object') return null;
    const handle = normalizeHandle(p.handle);
    if (!handle) return null;
    const str = (v, n) => String(v || '').slice(0, n);
    const out = {
        id: /^\d{1,25}$/.test(String(p.id || '')) ? String(p.id) : '',
        handle,
        name: str(p.name, 100),
        text: str(p.text, SEEN_TEXT_MAX),
        time: str(p.time, 40),
        page: str(p.page, 200),
        y: Number.isFinite(p.y) ? Math.round(p.y) : 0
    };
    const replyTo = (Array.isArray(p.replyTo) ? p.replyTo : []).map(normalizeHandle).filter(Boolean).slice(0, 10);
    if (replyTo.length) out.replyTo = replyTo;
    if (p.quote && typeof p.quote === 'object') {
        const qh = normalizeHandle(p.quote.handle);
        const qt = str(p.quote.text, 1000);
        if (qh || qt) out.quote = { handle: qh, text: qt };
    }
    if (p.repostedBy) {
        const rb = normalizeHandle(p.repostedBy);
        if (rb) out.repostedBy = rb;
    }
    out.key = seenPostKey(out);
    return out.key ? out : null;
}

// Merges a fresh sighting into the stored record (or makes a new one).
// A post with no text can't be rated, so it is never pending.
function mergeSeenPost(existing, post, now) {
    if (!existing) {
        return Object.assign({}, post, {
            firstSeen: now, lastSeen: now, seenCount: 1,
            pending: post.text.trim() ? 1 : 0, attempts: 0
        });
    }
    const out = Object.assign({}, existing);
    out.lastSeen = now;
    out.seenCount = (existing.seenCount || 1) + 1;
    // A post seen again after "Show more" has longer text: keep the longer one
    // and rate it again if it was rated on the short version.
    if (post.text.length > (existing.text || '').length) {
        out.text = post.text;
        if (existing.faith) { out.pending = 1; out.attempts = 0; }
        if (!existing.faith && !existing.pending && post.text.trim()) out.pending = 1;
    }
    for (const k of ['name', 'time', 'quote', 'replyTo', 'repostedBy']) {
        if (out[k] === undefined || out[k] === '') if (post[k] !== undefined && post[k] !== '') out[k] = post[k];
    }
    return out;
}

// --- Rating ----------------------------------------------------------------

const RATING_SYSTEM_PROMPT = `You rate posts from X (Twitter) on two scales from 1 to 10.

Good faith: does the author engage honestly with other people and ideas?
1-2 clear bad faith: strawmanning or misrepresenting someone, mockery or contempt in place of an argument, insults, trolling or baiting, deliberately misleading.
3-4 leaning bad faith: point-scoring, sneering dismissal without engaging, an uncharitable reading of the other side.
5-6 mixed or unclear.
7-8 ordinary good faith: honest statements, real questions, fair disagreement, news, jokes, personal updates.
9-10 exemplary: represents opponents fairly, engages the strongest version of a view, admits uncertainty or error.

Sincerity: does the author mean what they say, and say it for its own sake?
1-2 clearly insincere: engagement bait, rage farming, performative outrage, trolling, grift or spam, saying what will get attention instead of what they think.
3-4 leaning insincere: empty hype, vague-posting for engagement, clout-chasing, ironic provocation.
5-6 mixed or unclear.
7-8 sincere: says what they think, shares something real, honest humor.
9-10 notably candid: personal, vulnerable, or carefully considered.

Being wrong, blunt, angry, briefly sarcastic, or strongly disagreeing is not bad faith or insincerity on its own. Judge how the post argues, not its topic or which side it takes. A post with little to judge, such as a link, a greeting or a one-word reply, gets 7 on both unless something shows otherwise.

Posts under the same page heading were on screen together, top to bottom, and are often one conversation; use them as context for each other. A quoted post is context only: rate what the author wrote.

Reply with exactly one line per post, in this form, and nothing else:
<r id="1" faith="7" sincerity="8"/>`;

// The user text for one batch. posts: stored records. Grouped by the page
// they were seen on, top to bottom, so a reply sits under what it answers.
// Returns { text, ids: Map(number -> key) }.
function buildRatingRequest(posts) {
    const groups = new Map();
    for (const p of posts) {
        const page = p.page || '/';
        if (!groups.has(page)) groups.set(page, []);
        groups.get(page).push(p);
    }
    const ids = new Map();
    const esc = s => String(s || '').replace(/</g, '‹').replace(/>/g, '›');
    const lines = [];
    let n = 0;
    for (const [page, list] of groups) {
        list.sort((a, b) => (a.y || 0) - (b.y || 0));
        lines.push(`=== Page ${esc(page)} ===`);
        for (const p of list) {
            n += 1;
            ids.set(n, p.key);
            const attrs = [`id="${n}"`, `author="${p.handle}"`];
            if (p.replyTo && p.replyTo.length) attrs.push(`replying_to="${p.replyTo.join(' ')}"`);
            if (p.repostedBy) attrs.push(`reposted_by="${p.repostedBy}"`);
            let body = esc(p.text);
            if (p.quote && (p.quote.text || p.quote.handle)) body += `\n[quoting ${p.quote.handle || 'a post'}: ${esc(p.quote.text)}]`;
            lines.push(`<post ${attrs.join(' ')}>\n${body}\n</post>`);
        }
    }
    return { text: lines.join('\n'), ids };
}

// The model's reply -> Map(number -> { faith, sincerity }), scores clamped
// to 1-10. Lines it can't read are skipped.
function parseRatings(text) {
    const out = new Map();
    const re = /<r\b([^>]*)\/?>/gi;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
        const attr = name => {
            const a = new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+(?:\\.\\d+)?)`, 'i').exec(m[1]);
            return a ? parseFloat(a[1]) : NaN;
        };
        const id = attr('id'), faith = attr('faith'), sincerity = attr('sincerity');
        if (!Number.isInteger(id) || !isFinite(faith) || !isFinite(sincerity)) continue;
        const clamp = v => Math.min(10, Math.max(1, Math.round(v)));
        out.set(id, { faith: clamp(faith), sincerity: clamp(sincerity) });
    }
    return out;
}

// One post's combined score.
function postScore(p) {
    return (p.faith + p.sincerity) / 2;
}

// --- Accounts --------------------------------------------------------------

// Adds rated posts to their accounts. accounts: { "@h": record } for the
// handles involved (missing ones are created). rated: stored post records
// with faith and sincerity. Returns the changed account records.
function addRatingsToAccounts(accounts, rated, now) {
    const out = {};
    for (const p of rated) {
        const h = p.handle;
        const acc = out[h] || (accounts[h] ? JSON.parse(JSON.stringify(accounts[h])) : { handle: h, posts: [], forgivenAt: 0 });
        out[h] = acc;
        const entry = { k: p.key, ts: p.firstSeen || now, f: p.faith, s: p.sincerity };
        const i = acc.posts.findIndex(x => x.k === p.key);
        if (i >= 0) acc.posts[i] = entry; else acc.posts.push(entry);
        acc.posts = acc.posts
            .filter(x => now - x.ts < ACCOUNT_WINDOW_MS)
            .sort((a, b) => a.ts - b.ts)
            .slice(-ACCOUNT_RECENT_POSTS);
        acc.updated = now;
    }
    return out;
}

// An account's score: { score, mean, n } over posts that count (seen after
// the last like, inside the window). score is null under SCORE_MIN_POSTS.
function accountScore(acc, now) {
    const posts = ((acc && acc.posts) || []).filter(x => x.ts > (acc.forgivenAt || 0) && now - x.ts < ACCOUNT_WINDOW_MS);
    const n = posts.length;
    if (!n) return { score: null, mean: null, n: 0 };
    const sum = posts.reduce((s, x) => s + (x.f + x.s) / 2, 0);
    const shrunk = (sum + SCORE_PRIOR_MEAN * SCORE_PRIOR_WEIGHT) / (n + SCORE_PRIOR_WEIGHT);
    const round1 = v => Math.round(v * 10) / 10;
    return { score: n >= SCORE_MIN_POSTS ? round1(shrunk) : null, mean: round1(sum / n), n };
}

// Sets forgivenAt for accounts the user liked a post of after their last
// forgiveness. likes: [{ handle, ts: ISO }]. Returns the changed records.
function forgiveScoredAccounts(accounts, likes) {
    const out = {};
    for (const l of likes || []) {
        const h = normalizeHandle(l && l.handle);
        const ts = Date.parse(l && l.ts);
        const acc = h && (out[h] || accounts[h]);
        if (!acc || !isFinite(ts) || ts <= (acc.forgivenAt || 0)) continue;
        out[h] = Object.assign({}, acc, { forgivenAt: ts });
    }
    return out;
}

// { "@h": [score, n] } for every account with a score.
function scoreIndex(accountList, now) {
    const out = {};
    for (const acc of accountList || []) {
        const s = accountScore(acc, now);
        if (s.score !== null) out[acc.handle] = [s.score, s.n];
    }
    return out;
}

// A stored or typed threshold -> a number from 1 to 7 in half steps.
function scoreThresholdFrom(value) {
    const n = Math.round(Number(value) * 2) / 2;
    if (value === undefined || value === null || value === '' || !isFinite(n)) return DEFAULT_SCORE_MUTE_THRESHOLD;
    return Math.min(SCORE_MUTE_THRESHOLD_MAX, Math.max(SCORE_MUTE_THRESHOLD_MIN, n));
}

// Accounts the score mutes right now: [{ handle, score, n }].
function scoreMutedAccounts(index, { threshold, following, ownHandle } = {}) {
    const t = scoreThresholdFrom(threshold);
    const own = normalizeHandle(ownHandle);
    return Object.keys(index || {})
        .filter(h => h !== own && !(following && following[h] === true))
        .map(h => ({ handle: h, score: index[h][0], n: index[h][1] }))
        .filter(m => m.score <= t)
        .sort((a, b) => a.score - b.score);
}

// The white box text for a post by a score-muted account.
function scoreMuteNote(m) {
    return `Muted by Forcefield: ${m.handle} averages ${m.score.toFixed(1)}/10 for good faith and sincerity over ${m.n} posts`;
}

// --- Store -----------------------------------------------------------------
// IndexedDB in the extension's own origin, so the service worker and the
// popup share it. Where there is no IndexedDB (the node tests), a store in
// memory with the same methods.

function openSeenDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(SEEN_DB_NAME, SEEN_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('seenPosts')) {
                const s = db.createObjectStore('seenPosts', { keyPath: 'key' });
                s.createIndex('pending', 'pending');
                s.createIndex('lastSeen', 'lastSeen');
                s.createIndex('pendingSeen', ['pending', 'lastSeen']);
            }
            if (!db.objectStoreNames.contains('accounts')) db.createObjectStore('accounts', { keyPath: 'handle' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbRequest(req) {
    return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function idbDone(tx) {
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}

function makeIdbSeenStore() {
    let dbp = null;
    const db = () => (dbp = dbp || openSeenDb().catch(e => { dbp = null; throw e; }));
    return {
        async getPosts(keys) {
            const tx = (await db()).transaction('seenPosts', 'readonly');
            const s = tx.objectStore('seenPosts');
            return Promise.all(keys.map(k => idbRequest(s.get(k))));
        },
        async putPosts(records) {
            const tx = (await db()).transaction('seenPosts', 'readwrite');
            const s = tx.objectStore('seenPosts');
            records.forEach(r => s.put(r));
            return idbDone(tx);
        },
        // Newest sightings first.
        async pendingPosts(limit) {
            const tx = (await db()).transaction('seenPosts', 'readonly');
            const range = IDBKeyRange.bound([1, -Infinity], [1, Infinity]);
            const req = tx.objectStore('seenPosts').index('pendingSeen').openCursor(range, 'prev');
            const out = [];
            return new Promise((resolve, reject) => {
                req.onsuccess = () => {
                    const c = req.result;
                    if (!c || out.length >= limit) return resolve(out);
                    out.push(c.value);
                    c.continue();
                };
                req.onerror = () => reject(req.error);
            });
        },
        async allPosts() {
            const tx = (await db()).transaction('seenPosts', 'readonly');
            return idbRequest(tx.objectStore('seenPosts').getAll());
        },
        async counts() {
            const tx = (await db()).transaction('seenPosts', 'readonly');
            const s = tx.objectStore('seenPosts');
            const [total, pending] = await Promise.all([idbRequest(s.count()), idbRequest(s.index('pending').count(IDBKeyRange.only(1)))]);
            return { total, pending };
        },
        // Drops the posts seen longest ago past max.
        async trim(max) {
            const d = await db();
            const total = await idbRequest(d.transaction('seenPosts', 'readonly').objectStore('seenPosts').count());
            if (total <= max) return 0;
            let drop = total - max, dropped = 0;
            const tx = d.transaction('seenPosts', 'readwrite');
            const cursorReq = tx.objectStore('seenPosts').index('lastSeen').openCursor();
            await new Promise((resolve, reject) => {
                cursorReq.onsuccess = () => {
                    const c = cursorReq.result;
                    if (!c || drop <= 0) return resolve();
                    c.delete(); drop--; dropped++;
                    c.continue();
                };
                cursorReq.onerror = () => reject(cursorReq.error);
            });
            await idbDone(tx);
            return dropped;
        },
        async getAccounts(handles) {
            const tx = (await db()).transaction('accounts', 'readonly');
            const s = tx.objectStore('accounts');
            const list = await Promise.all(handles.map(h => idbRequest(s.get(h))));
            const out = {};
            list.forEach(a => { if (a) out[a.handle] = a; });
            return out;
        },
        async putAccounts(records) {
            const tx = (await db()).transaction('accounts', 'readwrite');
            const s = tx.objectStore('accounts');
            records.forEach(r => s.put(r));
            return idbDone(tx);
        },
        async allAccounts() {
            const tx = (await db()).transaction('accounts', 'readonly');
            return idbRequest(tx.objectStore('accounts').getAll());
        },
        async deleteAccounts(handles) {
            const tx = (await db()).transaction('accounts', 'readwrite');
            const s = tx.objectStore('accounts');
            handles.forEach(h => s.delete(h));
            return idbDone(tx);
        }
    };
}

function makeMemorySeenStore() {
    const posts = new Map(), accounts = new Map();
    const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    return {
        posts, accounts,
        async getPosts(keys) { return keys.map(k => copy(posts.get(k))); },
        async putPosts(records) { records.forEach(r => posts.set(r.key, copy(r))); },
        async pendingPosts(limit) { return [...posts.values()].filter(p => p.pending === 1).sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit).map(copy); },
        async allPosts() { return [...posts.values()].map(copy); },
        async counts() { return { total: posts.size, pending: [...posts.values()].filter(p => p.pending === 1).length }; },
        async trim(max) {
            const sorted = [...posts.values()].sort((a, b) => a.lastSeen - b.lastSeen);
            const drop = sorted.slice(0, Math.max(0, sorted.length - max));
            drop.forEach(p => posts.delete(p.key));
            return drop.length;
        },
        async getAccounts(handles) { const out = {}; handles.forEach(h => { if (accounts.has(h)) out[h] = copy(accounts.get(h)); }); return out; },
        async putAccounts(records) { records.forEach(r => accounts.set(r.handle, copy(r))); },
        async allAccounts() { return [...accounts.values()].map(copy); },
        async deleteAccounts(handles) { handles.forEach(h => accounts.delete(h)); }
    };
}

function makeSeenStore() {
    return typeof indexedDB !== 'undefined' ? makeIdbSeenStore() : makeMemorySeenStore();
}

// Saves a batch of sightings. Returns how many posts were new.
async function recordSeenPostsInStore(store, rawPosts, now) {
    const clean = [];
    const seen = new Set();
    for (const raw of rawPosts || []) {
        const p = cleanSeenPost(raw);
        if (p && !seen.has(p.key)) { seen.add(p.key); clean.push(p); }
    }
    if (!clean.length) return 0;
    const existing = await store.getPosts(clean.map(p => p.key));
    await store.putPosts(clean.map((p, i) => mergeSeenPost(existing[i], p, now)));
    return existing.filter(e => !e).length;
}

// Writes the model's ratings for one batch onto the posts and their
// accounts. Posts the reply left out are tried again later, up to
// RATE_MAX_ATTEMPTS times. Returns the rated records.
async function applyRatingsToStore(store, batch, ids, ratings, model, now) {
    const byKey = new Map();
    for (const [n, r] of ratings) { const k = ids.get(n); if (k) byKey.set(k, r); }
    const rated = [];
    const updates = batch.map(p => {
        const r = byKey.get(p.key);
        const out = Object.assign({}, p);
        if (r) {
            Object.assign(out, { faith: r.faith, sincerity: r.sincerity, ratedAt: now, model, pending: 0 });
            rated.push(out);
        } else {
            out.attempts = (p.attempts || 0) + 1;
            if (out.attempts >= RATE_MAX_ATTEMPTS) out.pending = 0;
        }
        return out;
    });
    await store.putPosts(updates);
    if (rated.length) {
        const handles = [...new Set(rated.map(p => p.handle))];
        const accounts = await store.getAccounts(handles);
        await store.putAccounts(Object.values(addRatingsToAccounts(accounts, rated, now)));
    }
    return rated;
}

self.ForcefieldSeenPosts = {
    SEEN_MAX_POSTS, RATE_BATCH_SIZE, RATE_BATCHES_PER_RUN, RATE_MAX_ATTEMPTS, ACCOUNT_RECENT_POSTS, ACCOUNT_WINDOW_MS,
    SCORE_MIN_POSTS, SCORE_PRIOR_MEAN, SCORE_PRIOR_WEIGHT, DEFAULT_SCORE_MUTE_THRESHOLD, SCORE_MUTE_THRESHOLD_MIN, SCORE_MUTE_THRESHOLD_MAX,
    RATING_SYSTEM_PROMPT,
    seenPostKey, cleanSeenPost, mergeSeenPost, buildRatingRequest, parseRatings, postScore,
    addRatingsToAccounts, accountScore, forgiveScoredAccounts, scoreIndex, scoreThresholdFrom, scoreMutedAccounts, scoreMuteNote,
    makeSeenStore, makeIdbSeenStore, makeMemorySeenStore, recordSeenPostsInStore, applyRatingsToStore
};
