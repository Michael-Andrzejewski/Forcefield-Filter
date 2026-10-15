// Boots the whole service worker (llm.js + jev.js + background.js, as
// importScripts would) against a fake chrome, then moves the Hide level and
// checks that every open allowed page is re-blocked with the right entries.
// Usage: node tests/severity/reapply.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

const store = {
    sync: { allowedSites: ['x.com', 'quora.com'], hideThreshold: 3 },
    local: {
        isScanning: false, whiteboxMode: true, debugMode: false,
        blockList: [
            { text: 'mild', level: 8, source: 'ai_continuous', severity: 2 },
            { text: 'divisive', level: 8, source: 'jev', severity: 5 },
            { text: 'hostile', level: 8, source: 'ai_continuous', severity: 8 },
            { text: 'typed by hand', level: 8, source: 'manual' }
        ]
    }
};
const tabs = [
    { id: 1, url: 'https://x.com/home', active: true },
    { id: 2, url: 'https://www.quora.com/some-question', active: false },
    { id: 3, url: 'https://example.com/', active: false },
    { id: 4, url: 'chrome://extensions/', active: false }
];
const executed = [];
const changeListeners = [];
const pick = (area, keys) => {
    if (keys == null) return Object.assign({}, area);
    const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    return Object.fromEntries(list.filter(k => k in area).map(k => [k, JSON.parse(JSON.stringify(area[k]))]));
};
const storageArea = area => ({
    get(keys, cb) { const r = pick(area, keys); if (cb) { setTimeout(() => cb(r), 0); return; } return Promise.resolve(r); },
    set(obj, cb) { Object.assign(area, JSON.parse(JSON.stringify(obj))); if (cb) { setTimeout(cb, 0); return; } return Promise.resolve(); },
    remove(keys, cb) { [].concat(keys).forEach(k => delete area[k]); if (cb) { setTimeout(cb, 0); return; } return Promise.resolve(); }
});
// Anything not faked below: a harmless no-op that also works as an event.
const anything = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : k === 'addListener' ? () => {} : anything()),
    apply: (t, self, args) => { const cb = args.find(a => typeof a === 'function'); if (cb) setTimeout(() => cb([]), 0); return Promise.resolve([]); }
});
const orAnything = obj => new Proxy(obj, { get: (t, k) => (k in t ? t[k] : anything()) });
const chrome = orAnything({
    storage: orAnything({ sync: storageArea(store.sync), local: storageArea(store.local), onChanged: { addListener: fn => changeListeners.push(fn) } }),
    tabs: orAnything({ query: async () => tabs, get: async id => tabs.find(t => t.id === id) }),
    scripting: orAnything({
        executeScript: async opts => { executed.push(opts); return []; },
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, updateContentScripts: async () => {}, unregisterContentScripts: async () => {}
    })
});

const errors = [];
const box = {
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')), info() {} },
    chrome, self: {}, importScripts: () => {}, fetch: async () => { throw new Error('no network in tests'); },
    setTimeout, clearTimeout, setInterval, clearInterval, URL, Promise, JSON, Date, Math
};
vm.createContext(box);
for (const f of ['llm.js', 'jev.js', 'background.js']) {
    try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), box, { filename: f }); }
    catch (e) { check(false, `${f} loads without throwing`, e.stack.split('\n').slice(0, 3).join(' | ')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const blockerRuns = () => executed.filter(e => e.func && e.func.name === 'actualContentBlockingFunction');
async function moveSlider(to) {
    const from = store.sync.hideThreshold;
    store.sync.hideThreshold = to;
    executed.length = 0;
    changeListeners.forEach(fn => fn({ hideThreshold: { oldValue: from, newValue: to } }, 'sync'));
    await sleep(80);
    return blockerRuns().map(e => ({ tab: e.target.tabId, texts: e.args[0].map(i => i.text).join('|') })).sort((a, b) => a.tab - b.tab);
}

(async () => {
    await sleep(50); // let start-up work settle
    check(changeListeners.length >= 3, 'service worker registered its storage listeners', changeListeners.length);
    {
        const runs = await moveSlider(8);
        check(runs.map(r => r.tab).join(',') === '1,2', 'slider moved -> blocker re-run on the open X and Quora tabs only', JSON.stringify(runs));
        check(runs.every(r => r.texts === 'hostile|typed by hand'), 'level 8: only the 8 and the unrated entry are sent', JSON.stringify(runs));
    }
    {
        const runs = await moveSlider(1);
        check(runs.length === 2 && runs.every(r => r.texts === 'mild|divisive|hostile|typed by hand'), 'level 1: everything sent', JSON.stringify(runs));
    }
    {
        const runs = await moveSlider(5);
        check(runs.every(r => r.texts === 'divisive|hostile|typed by hand'), 'level 5: the 5 is included', JSON.stringify(runs));
    }
    {
        executed.length = 0;
        changeListeners.forEach(fn => fn({ selectedAiModel: { newValue: 'claude-haiku-5-5' } }, 'sync'));
        changeListeners.forEach(fn => fn({ hideThreshold: { newValue: 9 } }, 'local'));
        await sleep(80);
        check(blockerRuns().length === 0, 'other setting changes, or a local key of the same name, do not re-run the blocker');
    }
    {
        const saved = store.local.blockList;
        store.local.blockList = [];
        const runs = await moveSlider(2);
        check(runs.length === 0, 'empty blocklist -> nothing to re-run');
        store.local.blockList = saved;
    }
    check(errors.length === 0, 'no errors logged', errors.slice(0, 3).join(' | '));
    console.log(`severity reapply: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
