// Runs the REAL page-script registration and claimScanForTab code from
// background.js against fake chrome APIs.
// Usage: node tests/wake/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8');

const a = src.indexOf('// --- Page script registration');
const b = src.indexOf('// Load activeScanTabId on startup');
const s = src.indexOf('async function isSiteAllowed');
let depth = 0, e = -1;
for (let i = src.indexOf('{', src.indexOf(')', s)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { e = i + 1; break; } }
}
if (a < 0 || b < 0 || s < 0) { console.log('wake: could not find code'); process.exit(1); }
const code = src.slice(a, b) + '\n' + src.slice(s, e);

let pass = 0, fail = 0;
const check = (c, n, d) => { if (c) pass++; else { fail++; console.log('  FAIL', n + (d ? ' :: ' + d : '')); } };

function make({ sync = {}, local = {}, registered = [] } = {}) {
    const st = { sync: Object.assign({}, sync), local: Object.assign({}, local), registered: registered.slice(), calls: [], stopped: [], startup: [], changed: [] };
    const pick = (o, k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in o).map(x => [x, o[x]]));
    const box = {
        console: { log() {}, warn() {} }, Promise, Set, JSON, String, URL,
        chrome: {
            storage: {
                sync: { get: (k, cb) => { const r = pick(st.sync, k); if (cb) { cb(r); return; } return Promise.resolve(r); } },
                local: { get: async k => pick(st.local, k), set: async o => Object.assign(st.local, o) },
                onChanged: { addListener: fn => st.changed.push(fn) }
            },
            runtime: { onStartup: { addListener: fn => st.startup.push(fn) } },
            scripting: {
                getRegisteredContentScripts: async ({ ids }) => st.registered.filter(r => ids.includes(r.id)),
                registerContentScripts: async defs => { st.calls.push(['register', defs[0]]); defs.forEach(d => { if (st.registered.some(r => r.id === d.id)) throw new Error('Duplicate script ID'); st.registered.push(d); }); },
                updateContentScripts: async defs => { st.calls.push(['update', defs[0]]); defs.forEach(d => { const i = st.registered.findIndex(r => r.id === d.id); st.registered[i] = d; }); },
                unregisterContentScripts: async ({ ids }) => { st.calls.push(['unregister']); st.registered = st.registered.filter(r => !ids.includes(r.id)); }
            }
        },
        stopObserverInTab: id => st.stopped.push(id)
    };
    vm.createContext(box);
    vm.runInContext(code + '\n;globalThis.__w = { matchPatternsForSites, syncContinuousScanRegistration, claimScanForTab, regDone: () => registrationChain };', box);
    return { w: box.__w, st };
}
const tab = (id, url, active = true) => ({ id, url, active });

(async () => {
    // Registration
    {
        const { w, st } = make({ sync: { allowedSites: ['twitter.com', 'x.com', 'quora.com'] } });
        await w.regDone();
        const r = st.registered[0];
        check(st.registered.length === 1 && r.js[0] === 'continuousScan.js', 'page script registered on worker start');
        check(r.matches.join(' ') === '*://twitter.com/* *://*.twitter.com/* *://x.com/* *://*.x.com/* *://quora.com/* *://*.quora.com/*', 'matches each allowed site and its subdomains', r.matches.join(' '));
        check(r.persistAcrossSessions === true && r.runAt === 'document_idle', 'survives browser restarts, runs after the page loads');
        check(st.startup.length === 1 && st.changed.length === 1, 'listens for browser start and allowed-site changes');
        st.sync.allowedSites = ['x.com', 'news.ycombinator.com'];
        st.changed[0]({ allowedSites: {} }, 'sync');
        await w.regDone();
        check(st.registered.length === 1 && st.calls.at(-1)[0] === 'update' && st.registered[0].matches.includes('*://news.ycombinator.com/*') && !st.registered[0].matches.some(m => m.includes('quora')), 'editing allowed sites updates the registration');
        st.changed[0]({ customSystemPrompt: {} }, 'sync');
        await w.regDone();
        check(st.calls.length === 2, 'unrelated setting changes do not touch it', st.calls.length);
    }
    {
        const { w, st } = make({});
        await w.regDone();
        check(st.registered[0].matches.includes('*://x.com/*'), 'no saved sites yet (fresh install) -> default sites');
    }
    {
        const { w, st } = make({ sync: { allowedSites: [] } });
        await w.regDone();
        check(st.registered[0].matches.join(' ') === 'http://*/* https://*/*', 'empty site list means every site, like isSiteAllowed');
    }
    {
        const { w } = make({ sync: { allowedSites: ['x.com'] } });
        check(w.matchPatternsForSites(['https://X.com/home', 'not a site', 'quora.com', 'quora.com']).join(' ') === '*://x.com/* *://*.x.com/* *://quora.com/* *://*.quora.com/*', 'pasted URLs cleaned, junk dropped, duplicates merged');
    }
    {
        const { w, st } = make({ sync: { allowedSites: ['x.com'] } });
        w.syncContinuousScanRegistration(); w.syncContinuousScanRegistration(); // overlapping with the start-up call
        await w.regDone();
        check(st.registered.length === 1 && !st.calls.some(c => c[0] === 'register' && st.calls.filter(x => x[0] === 'register').length > 1), 'overlapping updates never double-register', JSON.stringify(st.calls.map(c => c[0])));
    }
    {
        const { w, st } = make({ sync: { allowedSites: ['not a site'] }, registered: [{ id: 'forcefield-continuous-scan', js: ['continuousScan.js'], matches: ['*://x.com/*'] }] });
        await w.regDone();
        check(st.registered.length === 0, 'no valid sites -> registration removed');
    }

    // claimScanForTab: the cases that used to need the popup
    const sites = { allowedSites: ['x.com', 'quora.com'] };
    {
        const { w, st } = make({ sync: sites, local: { isScanning: true, activeScanTabId: 7 } });
        const r = await w.claimScanForTab(tab(7, 'https://x.com/home'));
        check(r.start === true && st.stopped.length === 0, 'refreshed scan tab -> scans again, nothing stopped');
    }
    {
        const { w, st } = make({ sync: sites, local: { isScanning: true, activeScanTabId: null } });
        const r = await w.claimScanForTab(tab(9, 'https://x.com/home'));
        check(r.start === true && st.local.activeScanTabId === 9, 'new X tab after a new-tab page -> becomes the scan tab', JSON.stringify(st.local));
    }
    {
        const { w, st } = make({ sync: sites, local: { isScanning: true, activeScanTabId: 7 } });
        const r = await w.claimScanForTab(tab(12, 'https://www.quora.com/q'));
        check(r.start === true && st.local.activeScanTabId === 12 && st.stopped.join() === '7', 'tab in front takes over; previous scan tab stopped');
    }
    {
        const { w } = make({ sync: sites, local: { isScanning: true, activeScanTabId: 7 } });
        const r = await w.claimScanForTab(tab(13, 'https://x.com/home', false));
        check(r.start === false && r.reason === 'tab not in front', 'background tab does not steal the scan', JSON.stringify(r));
    }
    {
        const { w } = make({ sync: sites, local: { isScanning: false } });
        const r = await w.claimScanForTab(tab(7, 'https://x.com/home'));
        check(r.start === false && r.reason === 'scanning is off', 'scanning switched off -> stays off');
    }
    {
        const { w } = make({ sync: sites, local: { isScanning: true } });
        const r = await w.claimScanForTab(tab(7, 'https://netflix.com/'));
        check(r.start === false && r.reason === 'site not allowed', 'site not allowed -> no scan (netflix.com is not x.com)');
    }
    {
        const { w } = make({ sync: sites, local: { isScanning: true } });
        const r = await w.claimScanForTab(undefined);
        check(r.start === false, 'message without a tab -> no scan');
    }
    console.log(`wake: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
