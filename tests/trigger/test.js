// Runs the REAL triggerPageBlock from background.js with fake chrome APIs and
// checks which allowed-post keys and which blocklist entries (by Hide level)
// it hands to the page blocker.
// Usage: node tests/trigger/test.js [path/to/background.js]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', 'background.js'), 'utf8');
const llmSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'llm.js'), 'utf8');
const start = src.indexOf('async function triggerPageBlock');
let depth = 0, end = -1;
for (let i = src.indexOf('{', src.indexOf(')', start)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (start < 0 || end < 0) { console.log('trigger: could not find triggerPageBlock'); process.exit(1); }

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

async function run(local, sync = {}, blockList = [{ text: 'x', level: 1 }], session = {}) {
    const calls = [];
    const getter = area => async keys => { const r = {}; keys.forEach(k => { if (k in area) r[k] = area[k]; }); return r; };
    const box = {
        console: { log() {}, warn() {}, error() {} },
        self: {},
        actualContentBlockingFunction: function () {},
        chrome: {
            storage: { local: { get: getter(local) }, sync: { get: getter(sync) }, session: { get: getter(session) } },
            scripting: { executeScript: async opts => { calls.push(opts); return []; } }
        }
    };
    vm.createContext(box);
    vm.runInContext(llmSrc, box); // real entriesToHide / hideThresholdFrom
    vm.runInContext(src.slice(start, end) + '\n;globalThis.__t = triggerPageBlock;', box);
    await box.__t(5, blockList, false, true);
    return calls;
}
const RATED = [
    { text: 'mild', level: 8, source: 'ai_continuous', severity: 2 },
    { text: 'divisive', level: 8, source: 'jev', severity: 5 },
    { text: 'hateful', level: 8, source: 'ai_continuous', severity: 9 },
    { text: 'typed by hand', level: 8, source: 'manual' },
    { text: 'flagged before 2.10', level: 8, source: 'ai_continuous' }
];
const sent = calls => calls[0].args[0].map(i => i.text).join('|');

(async () => {
    {
        const calls = await run({});
        check(calls.length === 1, 'runs the blocker once');
        const args = calls[0].args;
        check(args.length === 5 && Array.isArray(args[3]) && args[3].length === 0, 'no allowed posts -> empty key list', JSON.stringify(args));
        check(args[2] === true && args[1] === false, 'passes whitebox and debug flags through');
        check(args[4] === null, 'severity debug view off by default');
    }
    // Severity debug view.
    {
        const calls = await run({ severityDebug: true }, { hideThreshold: 6 }, RATED, { scannedTweetKeys: ['abc', 'def'] });
        const view = calls[0].args[4];
        check(view && view.threshold === 6, 'debug view carries the hide level', JSON.stringify(view));
        check(view && view.entries.length === 5, 'debug view gets every entry, including ones below the level', view && view.entries.length);
        check(sent(calls) === 'hateful|typed by hand|flagged before 2.10', 'hiding still uses only entries at or above the level', sent(calls));
        check(view && view.scannedKeys.join(',') === 'abc,def', 'debug view gets the scanned tweet keys');
    }
    {
        const calls = await run({ severityDebug: true }, {}, RATED);
        check(calls[0].args[4].scannedKeys.length === 0 && calls[0].args[4].threshold === 3, 'nothing scanned yet -> empty key list, default level');
    }
    {
        const calls = await run({ severityDebug: false }, {}, RATED, { scannedTweetKeys: ['abc'] });
        check(calls[0].args[4] === null, 'switched off -> no view');
    }
    {
        const calls = await run({
            allowedPosts: [{ keys: ['url:https://x.com/a/status/1', 'text:hello'], removed: [] }],
            twitterActivity: { badBlock: [
                { text: 'old verdict', url: 'https://x.com/repligate/status/42?s=20' },
                { text: 'no link verdict', url: '' }
            ], goodBlock: [{ text: 'good', url: 'https://x.com/b/status/7' }] }
        });
        const keys = calls[0].args[3];
        check(keys.includes('url:https://x.com/a/status/1') && keys.includes('text:hello'), 'allowedPosts keys passed');
        check(keys.includes('url:https://x.com/repligate/status/42'), 'pre-2.7.2 Bad block verdicts allowed by link (query stripped)', JSON.stringify(keys));
        check(!keys.some(k => k.includes('/status/7')), 'Good block verdicts are not allowed');
        check(keys.length === 3, 'no empty or extra keys', JSON.stringify(keys));
    }
    {
        const calls = await run({ allowedPosts: [] });
        check(calls[0].args[0].length === 1, 'unrated block list passed unchanged');
    }
    // Hide level.
    {
        const calls = await run({}, {}, RATED);
        check(sent(calls) === 'divisive|hateful|typed by hand|flagged before 2.10', 'no level saved -> default 3: the 2 shows, unrated always hidden', sent(calls));
    }
    {
        const calls = await run({}, { hideThreshold: 1 }, RATED);
        check(calls[0].args[0].length === 5, 'level 1 -> everything hidden', sent(calls));
    }
    {
        const calls = await run({}, { hideThreshold: 5 }, RATED);
        check(sent(calls) === 'divisive|hateful|typed by hand|flagged before 2.10', 'level 5 is inclusive: a 5 is hidden', sent(calls));
    }
    {
        const calls = await run({}, { hideThreshold: 9 }, RATED);
        check(sent(calls) === 'hateful|typed by hand|flagged before 2.10', 'level 9 -> only the hateful one plus unrated', sent(calls));
    }
    {
        const calls = await run({}, { hideThreshold: 10 }, RATED.slice(0, 3));
        check(calls.length === 1 && calls[0].args[0].length === 0, 'nothing at or above the level -> blocker still runs, with an empty list (un-boxes what was hidden)', sent(calls));
    }
    {
        const calls = await run({}, { hideThreshold: 'junk' }, RATED);
        check(sent(calls).startsWith('divisive|'), 'junk level falls back to 3', sent(calls));
    }
    console.log(`trigger: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
