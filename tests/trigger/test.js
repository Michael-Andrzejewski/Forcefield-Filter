// Runs the REAL triggerPageBlock from background.js with fake chrome APIs and
// checks which allowed-post keys it hands to the page blocker.
// Usage: node tests/trigger/test.js [path/to/background.js]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', '..', 'background.js'), 'utf8');
const start = src.indexOf('async function triggerPageBlock');
let depth = 0, end = -1;
for (let i = src.indexOf('{', src.indexOf(')', start)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (start < 0 || end < 0) { console.log('trigger: could not find triggerPageBlock'); process.exit(1); }

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

async function run(local) {
    const calls = [];
    const box = {
        console: { log() {}, warn() {}, error() {} },
        actualContentBlockingFunction: function () {},
        chrome: {
            storage: { local: { get: async keys => { const r = {}; keys.forEach(k => { if (k in local) r[k] = local[k]; }); return r; } } },
            scripting: { executeScript: async opts => { calls.push(opts); return []; } }
        }
    };
    vm.createContext(box);
    vm.runInContext(src.slice(start, end) + '\n;globalThis.__t = triggerPageBlock;', box);
    await box.__t(5, [{ text: 'x', level: 1 }], false, true);
    return calls;
}

(async () => {
    {
        const calls = await run({});
        check(calls.length === 1, 'runs the blocker once');
        const args = calls[0].args;
        check(args.length === 4 && Array.isArray(args[3]) && args[3].length === 0, 'no allowed posts -> empty key list', JSON.stringify(args));
        check(args[2] === true && args[1] === false, 'passes whitebox and debug flags through');
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
        check(calls[0].args[0].length === 1, 'block list passed unchanged');
    }
    console.log(`trigger: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
