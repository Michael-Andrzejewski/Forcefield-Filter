// Boots the whole service worker (llm.js + jev.js + goodFaith.js + seenPosts.js +
// background.js, as importScripts would) against a fake chrome and a fake
// model, then runs scans on X: bad-faith tags count against their authors,
// the second one mutes, the page run boxes the account, a like unmutes it,
// and the switch turns it all off. Also the Jev path.
// Usage: node tests/good-faith/flow.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

const store = {
    session: {},
    sync: { allowedSites: ['x.com'], anthropicApiKey: 'test-key-not-real', selectedAiModel: 'claude-haiku-5-5', typesafeApiKey: 'test-key-not-real' },
    local: { isScanning: true, activeScanTabId: 1, whiteboxMode: true, debugMode: false, blockList: [], xOwnHandle: '@me', xFollowing: {} }
};
const tabs = [{ id: 1, url: 'https://x.com/home', active: true, status: 'complete' }];
const executed = [];
const changeListeners = [];
const messageListeners = [];
const clone = v => JSON.parse(JSON.stringify(v));
const pick = (area, keys) => {
    if (keys == null) return clone(area);
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter(k => k in area).map(k => [k, clone(area[k])]));
};
// Like Chrome: every write tells the onChanged listeners.
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
    scripting: orAnything({
        executeScript: async opts => { executed.push(opts); return []; },
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, updateContentScripts: async () => {}, unregisterContentScripts: async () => {}
    })
});

// The fake model: each scan pops the next reply. Requests are kept.
const requests = [];
let replies = [];
async function fakeFetch(url, opts) {
    const body = JSON.parse(opts.body);
    requests.push({ url, body });
    const reply = replies.shift();
    if (url.includes('anthropic')) {
        return { ok: true, json: async () => ({ content: [{ type: 'text', text: reply }], usage: { input_tokens: 100, output_tokens: 20 } }) };
    }
    return { ok: true, json: async () => reply(body), text: async () => '' };
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
const pageLogs = () => executed.filter(e => e.func && e.func.name !== 'actualContentBlockingFunction').map(e => e.args.join(' ')).join('\n');

// One debounced batch from the page, as continuousScan.js sends it.
async function scan(tweets, reply) {
    replies.push(reply);
    executed.length = 0;
    await new Promise(resolve => {
        messageListeners.forEach(fn => fn({ command: 'newContentDetected', text: tweets.map(t => t.text).join('\n\n'), tweets }, { tab: tabs[0] }, () => resolve()));
    });
    await sleep(120);
}
const tw = (handle, text) => ({ handle, text });

(async () => {
    await sleep(50);
    {
        await scan([tw('@Crank', 'Wow, only an idiot would read the paper that way, nice try pretending you understood it'), tw('@kind', 'Here is a careful summary of the paper with the key figure')],
            '<Negative severity="7" faith="bad">only an idiot would read the paper that way, nice try pretending you understood it</Negative>');
        const sys = requests[0] && requests[0].body.system[0].text;
        check(sys && sys.includes('Also judge each tag for bad faith') && sys.indexOf('Rate every tag from 1 to 10') < sys.indexOf('Also judge each tag for bad faith'), 'scan prompt carries the faith instructions after the rating rules');
        const e = store.local.badFaithLedger && store.local.badFaithLedger['@crank'];
        check(e && e.posts.length === 1 && e.mutes === 0, 'first bad-faith post counted against @crank', JSON.stringify(store.local.badFaithLedger));
        check(!store.local.badFaithLedger['@kind'], 'the good-faith author has no record');
        check(blockerRuns().length >= 1 && blockerRuns().every(r => r.args[5].length === 0), 'no mutes yet on the page');
        check(/Bad faith from @crank\./.test(pageLogs()), 'page console says who posted in bad faith', pageLogs());
    }
    {
        await scan([tw('@crank', 'You clearly never did any math, so stop embarrassing yourself in public')],
            '<Negative severity="7" faith="bad">You clearly never did any math, so stop embarrassing yourself in public</Negative>');
        const e = store.local.badFaithLedger['@crank'];
        check(e.mutes === 1 && e.mutedUntil - e.mutedAt === 3600 * 1000, 'second post: @crank muted for 1 hour', JSON.stringify(e));
        const runs = blockerRuns();
        const muted = runs.length && runs[runs.length - 1].args[5];
        check(muted && muted.length === 1 && muted[0].handle === '@crank' && /^Muted by Forcefield: @crank keeps arguing in bad faith \(mute 1, (60m|1h) left\)$/.test(muted[0].note), 'page run boxes @crank with the mute note', JSON.stringify(muted));
        check(/Muted @crank for 1 hour \(mute 1\)/.test(pageLogs()), 'page console says who was muted and for how long', pageLogs());
        check(runs.every(r => r.target.tabId === 1), 'runs on the X tab');
    }
    {
        // A routine scroll re-run (runBlocker) with an empty blocklist still boxes the muted account.
        executed.length = 0;
        await new Promise(resolve => messageListeners.forEach(fn => fn({ command: 'runBlocker' }, { tab: tabs[0] }, resolve)));
        await sleep(50);
        check(blockerRuns().length === 1 && blockerRuns()[0].args[5].length === 1, 'runBlocker with mutes but no phrases still runs the page');
    }
    {
        // Own posts never count, even when the model says bad faith.
        await scan([tw('@Me', 'My own heated reply that the model will call bad faith for sure'), tw('@me', 'And a second heated reply of mine that it also calls bad faith')],
            '<Negative severity="6" faith="bad">My own heated reply that the model will call bad faith</Negative><Negative severity="6" faith="bad">a second heated reply of mine that it also calls bad faith</Negative>');
        check(!store.local.badFaithLedger['@me'], 'own posts are never counted');
    }
    {
        // A tag without faith="bad" is a block, not a strike.
        await scan([tw('@grumpy', 'This weather is absolutely awful and I hate everything about it today')],
            '<Negative severity="3">This weather is absolutely awful and I hate everything about it today</Negative>');
        check(!store.local.badFaithLedger['@grumpy'], 'a plain negative tag does not count against the author');
    }
    {
        // Liking one of their posts unmutes and resets.
        executed.length = 0;
        const liked = [{ text: 'a good post of theirs', handle: '@Crank', url: '', ts: new Date().toISOString() }];
        await chrome.storage.local.set({ twitterActivity: { liked, notInterested: [], muted: [], blocked: [] } });
        await sleep(120);
        const e = store.local.badFaithLedger['@crank'];
        check(e.mutes === 0 && e.mutedUntil === 0, 'like: @crank unmuted, ladder reset', JSON.stringify(e));
        const runs = blockerRuns();
        check(runs.length >= 1 && runs[runs.length - 1].args[5].length === 0, 'like: the page is re-run without the mute', runs.length);
    }
    {
        // Switched off: no faith prompt, no counting, nothing boxed.
        let r = box.self.ForcefieldGoodFaith.recordBadFaithPosts({}, [tw('@loud', 'loud one'), tw('@loud', 'loud two')], { now: Date.now() });
        await chrome.storage.local.set({ badFaithLedger: r.ledger });
        await sleep(50);
        executed.length = 0;
        await chrome.storage.sync.set({ goodFaithMutes: false });
        await sleep(80);
        check(blockerRuns().length === 1 && blockerRuns()[0].args[5].length === 0, 'switching off re-runs the page once, with no mutes');
        requests.length = 0;
        await scan([tw('@other', 'Another bad faith take that should not count while switched off')],
            '<Negative severity="7" faith="bad">Another bad faith take that should not count while switched off</Negative>');
        check(!requests[0].body.system[0].text.includes('Also judge each tag for bad faith'), 'switched off: no faith instructions');
        check(!store.local.badFaithLedger['@other'], 'switched off: nothing counted');
        executed.length = 0;
        await chrome.storage.sync.set({ goodFaithMutes: true });
        await sleep(80);
        check(blockerRuns().length === 1 && blockerRuns()[0].args[5].map(m => m.handle).join() === '@loud', 'switching back on re-boxes the muted account');
    }
    {
        // Jev: a second score question per tweet; bad faith counts on flagged tweets only.
        await chrome.storage.sync.set({ selectedAiModel: 'jev-latest' });
        await sleep(20);
        const answers = { t0: 4, f0: 0.9, t1: 4, f1: 0.95, t2: 0, f2: 0.99, t3: 3, f3: 0.2 };
        await scan([tw('@jevcrank', 'first jev bad faith tweet'), tw('@jevcrank', 'second jev bad faith tweet'), tw('@unflagged', 'not flagged but scored bad faith'), tw('@fine', 'flagged but good faith')],
            body => ({ model: 'jev-1', answers: Object.fromEntries(Object.keys(body.questions).map(k => [k, { type: 'score', score: answers[k] }])), usage: { input_tokens: 10 } }));
        const req = requests[requests.length - 1];
        check(req.url.includes('typesafe') && Object.keys(req.body.questions).join() === 't0,f0,t1,f1,t2,f2,t3,f3', 'Jev asked the faith question per tweet', req && Object.keys(req.body.questions).join());
        const L = store.local.badFaithLedger;
        check(L['@jevcrank'] && L['@jevcrank'].mutes === 1, 'Jev: two bad-faith tweets mute the account', JSON.stringify(L['@jevcrank']));
        check(!L['@unflagged'] && !L['@fine'], 'Jev: unflagged tweets and good-faith tweets do not count');
    }
    {
        // Temporary mute from a post's menu (twitterTracker.js asks, then mutes).
        const ask = msg => new Promise(resolve => messageListeners.forEach(fn => fn(msg, { tab: tabs[0] }, resolve)));
        let offer = await ask({ command: 'tempMuteOffer', handle: '@Annoy' });
        check(offer.offer === true && offer.days === 7, 'menu offer: 7 days the first time', JSON.stringify(offer));
        check((await ask({ command: 'tempMuteOffer', handle: '@me' })).offer === false, 'menu offer: not for your own account');
        await chrome.storage.sync.set({ goodFaithMutes: false }); // temporary mutes work with the switch off
        await sleep(30);
        executed.length = 0;
        const res = await ask({ command: 'tempMute', handle: '@Annoy' });
        await sleep(80);
        check(res.muted === true && res.handle === '@annoy' && res.days === 7, 'temporary mute saved', JSON.stringify(res));
        const runs = blockerRuns();
        const muted = runs.length ? runs[runs.length - 1].args[5] : [];
        check(muted.map(m => m.handle).join() === '@annoy' && /^Temporarily muted by you: @annoy \((7d|6d 23h) left\)$/.test(muted[0].note), 'page re-run boxes the account with the switch off; bad-faith mutes left out', JSON.stringify(muted));
        offer = await ask({ command: 'tempMuteOffer', handle: '@annoy' });
        check(offer.days === 30, 'picked again while on: the menu offers 30 days', JSON.stringify(offer));
        check((await ask({ command: 'tempMute', handle: '@annoy' })).days === 30, 'and mutes for 30');
        await chrome.storage.sync.set({ goodFaithMutes: true });
        await sleep(30);
    }
    check(errors.length === 0, 'no errors logged', errors.slice(0, 3).join(' | '));
    console.log(`good-faith flow: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
