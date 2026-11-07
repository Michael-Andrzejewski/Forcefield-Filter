// Boots the whole service worker (llm.js + jev.js + goodFaith.js +
// seenPosts.js + background.js, as importScripts would) against a fake chrome
// and a fake model. Posts arrive from the page, the minute alarm has the
// model rate them, account scores land in local `accountScores`, the page
// run boxes a low scorer, a like forgives, and the switches and budget work.
// Usage: node tests/seen-posts/flow.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d !== undefined ? ' :: ' + d : '')); } };

const store = {
    session: {},
    sync: { allowedSites: ['x.com'], anthropicApiKey: 'test-key-not-real', selectedAiModel: 'claude-sonnet-4-6' },
    local: { isScanning: true, activeScanTabId: 1, whiteboxMode: true, debugMode: false, blockList: [], xOwnHandle: '@me', xFollowing: { '@friend': true } }
};
const tabs = [{ id: 1, url: 'https://x.com/home', active: true, status: 'complete' }];
const executed = [];
const changeListeners = [];
const messageListeners = [];
const alarmListeners = [];
const alarmsCreated = [];
const clone = v => JSON.parse(JSON.stringify(v));
const pick = (area, keys) => {
    if (keys == null) return clone(area);
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter(k => k in area).map(k => [k, clone(area[k])]));
};
const storageArea = (area, name) => ({
    get(keys, cb) { const r = pick(area, keys); if (cb) { setTimeout(() => cb(r), 0); return; } return Promise.resolve(r); },
    set(obj, cb) {
        const changes = {};
        for (const [k, v] of Object.entries(clone(obj))) { changes[k] = { oldValue: area[k], newValue: v }; area[k] = v; }
        setTimeout(() => changeListeners.forEach(fn => fn(changes, name)), 0);
        if (cb) { setTimeout(cb, 0); return; } return Promise.resolve();
    },
    remove(keys, cb) { [].concat(keys).forEach(k => delete area[k]); if (cb) { setTimeout(cb, 0); return; } return Promise.resolve(); }
});
const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === 'addListener' ? () => {} : anything()),
    apply: (t, self, args) => { const cb = args.find(a => typeof a === 'function'); if (cb) setTimeout(() => cb([]), 0); return Promise.resolve([]); }
});
const orAnything = obj => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : anything()) });
const chrome = orAnything({
    storage: orAnything({ sync: storageArea(store.sync, 'sync'), local: storageArea(store.local, 'local'), session: storageArea(store.session, 'session'), onChanged: { addListener: fn => changeListeners.push(fn) } }),
    runtime: orAnything({ onMessage: { addListener: fn => messageListeners.push(fn) }, sendMessage: () => Promise.resolve(), lastError: undefined }),
    tabs: orAnything({ query: async () => tabs, get: async id => tabs.find(t => t.id === id) }),
    alarms: orAnything({
        get: (name, cb) => setTimeout(() => cb(undefined), 0),
        create: (name, info) => alarmsCreated.push({ name, info }),
        clear: () => Promise.resolve(true),
        onAlarm: { addListener: fn => alarmListeners.push(fn) }
    }),
    scripting: orAnything({
        executeScript: async opts => { executed.push(opts); return []; },
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, updateContentScripts: async () => {}, unregisterContentScripts: async () => {}
    })
});

// The fake model rates by author: a table of { faith, sincerity } per handle.
// Authors missing from the table are left out of the reply.
const requests = [];
let ratingsByAuthor = {};
async function fakeFetch(url, opts) {
    const body = JSON.parse(opts.body);
    requests.push({ url, body });
    const userText = url.includes('anthropic') ? body.messages[0].content : body.contents[0].parts[0].text;
    const lines = [];
    const re = /<post id="(\d+)" author="(@[a-z0-9_]+)"/g;
    let m;
    while ((m = re.exec(userText)) !== null) {
        const r = ratingsByAuthor[m[2]];
        if (r) lines.push(`<r id="${m[1]}" faith="${r.faith}" sincerity="${r.sincerity}"/>`);
    }
    const text = lines.join('\n');
    if (url.includes('anthropic')) {
        return { ok: true, json: async () => ({ content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 200 } }) };
    }
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } }) };
}

const errors = [];
const box = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')), info() {} },
    chrome, self: {}, importScripts: () => {}, fetch: fakeFetch,
    setTimeout, clearTimeout, setInterval, clearInterval, URL, Promise, JSON, Date, Math
};
vm.createContext(box);
for (const f of ['llm.js', 'jev.js', 'goodFaith.js', 'seenPosts.js', 'background.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), box, { filename: f }); }
    catch (e) { check(false, `${f} loads without throwing`, e.stack.split('\n').slice(0, 3).join(' | ')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blockerRuns = () => executed.filter(e => e.func && e.func.name === 'actualContentBlockingFunction');
const send = (msg) => new Promise(resolve => messageListeners.forEach(fn => fn(msg, { tab: tabs[0] }, resolve)));
const fireAlarm = async () => { alarmListeners.forEach(fn => fn({ name: 'forcefieldRateSeenPosts' })); await sleep(150); };
let nextId = 1000;
const posts = (handle, count, text = 'a post') => Array.from({ length: count }, (_, i) => ({ id: String(nextId++), handle, text: `${text} number ${i}`, page: '/home', y: i * 100 }));

(async () => {
    await sleep(50);
    check(alarmsCreated.some(a => a.name === 'forcefieldRateSeenPosts' && a.info.periodInMinutes === 1), 'a one-minute rating alarm is created', JSON.stringify(alarmsCreated));

    // Posts arrive from the page.
    {
        const res = await send({ command: 'recordSeenPosts', posts: [...posts('@Troll', 6), ...posts('@kind', 6), ...posts('@friend', 6), ...posts('@me', 6), { id: '1', handle: '@pic', text: '' }] });
        check(res && res.added === 25, 'all 25 posts recorded', JSON.stringify(res));
        const again = await send({ command: 'recordSeenPosts', posts: [{ id: '1000', handle: '@troll', text: 'a post number 0' }] });
        check(again.added === 0, 'a post seen again is not new');
    }

    // The alarm rates them.
    {
        ratingsByAuthor = { '@troll': { faith: 2, sincerity: 2 }, '@kind': { faith: 8, sincerity: 8 }, '@friend': { faith: 2, sincerity: 2 }, '@me': { faith: 1, sincerity: 1 } };
        executed.length = 0;
        await fireAlarm();
        check(requests.length === 1, 'one model call for 24 rateable posts', requests.length);
        const req = requests[0] && requests[0].body;
        check(req && req.model === 'claude-haiku-5-5', 'rated with Haiku 5.5 even though Sonnet is the scan model', req && req.model);
        check(req && /Good faith:/.test(typeof req.system === 'string' ? req.system : JSON.stringify(req.system)), 'the rating prompt is the system prompt');
        check(req && req.thinking && req.thinking.type === 'disabled', 'thinking off for Haiku 5.5');
        check(req && !/@pic/.test(req.messages[0].content), 'the photo post with no text is not sent');
        const scores = store.local.accountScores || {};
        check(JSON.stringify(scores['@troll']) === JSON.stringify([3.7, 6]), '@troll: six 2s -> (12 + 21) / 9 = 3.7', JSON.stringify(scores));
        check(JSON.stringify(scores['@kind']) === JSON.stringify([7.7, 6]), '@kind: 7.7');
        check(scores['@friend'] && scores['@me'], 'followed and own accounts get scores too');
        const totals = store.local.aiSpendTotals && store.local.aiSpendTotals.models;
        check(totals && totals['claude-haiku-5-5:ratings'] && totals['claude-haiku-5-5:ratings'].tweets === 24 && !totals['claude-haiku-5-5'], 'spend goes under Haiku post ratings, apart from scans', JSON.stringify(totals));
        await sleep(100);
        const runs = blockerRuns();
        const muted = runs.length ? runs[runs.length - 1].args[5] : [];
        check(runs.length >= 1 && muted.map(m => m.handle).join() === '@troll', 'the page run boxes @troll only (followed and own left out)', JSON.stringify(muted));
        check(muted[0] && muted[0].note === 'Muted by Forcefield: @troll averages 3.7/10 for good faith and sincerity over 6 posts', 'with the score note', muted[0] && muted[0].note);
    }

    // Nothing pending: the alarm makes no call.
    {
        await fireAlarm();
        check(requests.length === 1, 'nothing to rate -> no call');
    }

    // New ratings that change no mute don't re-run the page.
    {
        executed.length = 0;
        await send({ command: 'recordSeenPosts', posts: posts('@kind', 2, 'more kindness') });
        await fireAlarm();
        await sleep(100);
        check(requests.length === 2, 'two new posts rated');
        check(blockerRuns().length === 0, 'scores changed but nobody new is muted -> no page re-run', blockerRuns().length);
    }

    // The threshold slider moves.
    {
        executed.length = 0;
        await chrome.storage.sync.set({ scoreMuteThreshold: 3 });
        await sleep(100);
        const runs = blockerRuns();
        check(runs.length >= 1 && runs[runs.length - 1].args[5].length === 0, 'level 3 -> @troll (3.7) comes back', JSON.stringify(runs.map(r => r.args[5])));
        await chrome.storage.sync.set({ scoreMuteThreshold: 4 });
        await sleep(100);
    }

    // A like forgives.
    {
        executed.length = 0;
        const liked = [{ text: 'a post number 0', handle: '@troll', url: '', ts: new Date(Date.now() + 5).toISOString() }];
        await sleep(10);
        await chrome.storage.local.set({ twitterActivity: { liked, notInterested: [], muted: [], blocked: [] } });
        await sleep(150);
        check(!(store.local.accountScores || {})['@troll'], 'liking one of their posts clears their score', JSON.stringify(store.local.accountScores));
        const runs = blockerRuns();
        check(runs.length >= 1 && runs[runs.length - 1].args[5].length === 0, 'and unboxes them', JSON.stringify(runs.map(r => r.args[5])));
        // Their next posts count again.
        await send({ command: 'recordSeenPosts', posts: posts('@troll', 5, 'after the like') });
        await fireAlarm();
        await sleep(100);
        check(JSON.stringify(store.local.accountScores['@troll']) === JSON.stringify([3.9, 5]), 'posts seen after the like count: five 2s -> (10 + 21) / 8 = 3.9', JSON.stringify(store.local.accountScores['@troll']));
    }

    // The model leaves posts out: tried 3 times, then left alone.
    {
        const before = requests.length;
        await send({ command: 'recordSeenPosts', posts: posts('@quiet', 2) });
        for (let i = 0; i < 4; i++) await fireAlarm();
        check(requests.length - before === 3, 'three tries for posts the model keeps skipping', requests.length - before);
    }

    // The popup's Rate now.
    {
        await send({ command: 'recordSeenPosts', posts: posts('@kind', 1, 'rate me now') });
        const res = await send({ command: 'rateSeenPostsNow' });
        check(res && res.rated === 1 && res.pending === 0 && !res.error, 'Rate now rates and reports', JSON.stringify(res));
    }

    // The budget stops rating; posts wait.
    {
        const before = requests.length;
        store.local.aiSpendLog = [{ ts: Date.now(), cost: 50, model: 'x', tweets: 0 }];
        await send({ command: 'recordSeenPosts', posts: posts('@kind', 3, 'over budget') });
        const res = await send({ command: 'rateSeenPostsNow' });
        check(requests.length === before && res.error && /AI budget/.test(res.error) && res.pending === 3, 'over budget -> no call, posts stay pending', JSON.stringify(res));
        store.local.aiSpendLog = [];
    }

    // Only a Gemini key: Flash-Lite rates.
    {
        delete store.sync.anthropicApiKey;
        store.sync.geminiApiKey = 'test-key-not-real';
        const res = await send({ command: 'rateSeenPostsNow' });
        const last = requests[requests.length - 1];
        check(res.rated === 3 && last.url.includes('gemini-2.5-flash-lite'), 'Gemini key only -> Flash-Lite', JSON.stringify(res) + ' ' + last.url);
        delete store.sync.geminiApiKey;
        await send({ command: 'recordSeenPosts', posts: posts('@kind', 1, 'no key at all') });
        const none = await send({ command: 'rateSeenPostsNow' });
        check(none.reason === 'no key' && none.rated === 0, 'no key -> nothing rated, says why', JSON.stringify(none));
        store.sync.anthropicApiKey = 'test-key-not-real';
    }

    // Switches.
    {
        executed.length = 0;
        await chrome.storage.sync.set({ scoreMutes: false });
        await sleep(100);
        const runs = blockerRuns();
        check(runs.length >= 1 && runs[runs.length - 1].args[5].length === 0, 'score mutes off -> page re-run with nobody muted', JSON.stringify(runs.map(r => r.args[5])));
        await chrome.storage.sync.set({ scoreMutes: true, recordSeenPosts: false });
        await sleep(50);
        const res = await send({ command: 'recordSeenPosts', posts: posts('@new', 2) });
        check(res.added === 0, 'recording off -> nothing stored');
        const before = requests.length;
        const r2 = await send({ command: 'rateSeenPostsNow' });
        check(r2.reason === 'off' && requests.length === before, 'recording off -> no rating either', JSON.stringify(r2));
    }

    check(errors.length === 0, 'no console errors', errors.join(' | '));
    console.log(`seen-posts flow: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
