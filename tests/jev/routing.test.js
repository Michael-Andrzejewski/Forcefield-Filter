// Runs the REAL handleNewContent + scanTweetsWithJev from background.js with
// every dependency stubbed, and checks which engine each scan goes to.
// Usage: node tests/jev/routing.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8');

function extract(sig) {
    const start = src.indexOf(sig);
    if (start < 0) throw new Error('missing ' + sig);
    let depth = 0;
    for (let i = src.indexOf('{', src.indexOf(')', start)); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
}
const code = extract('async function scanTweetsWithJev') + '\n' + extract('async function handleNewContent');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

async function run(sync, tweets, jevScores) {
    const log = { llm: 0, jev: [], added: [], triggered: 0, page: [] };
    const box = {
        console: { log() {}, warn() {}, error() {} },
        chrome: { storage: {
            sync: { get: async () => sync },
            local: { get: async k => (k.includes('blockList') ? { blockList: [{ text: 'x', level: 8 }] } : { whiteboxMode: true, debugMode: false }) }
        } },
        DEFAULT_SYSTEM_PROMPT: 'default rules', DEFAULT_USER_PROMPT_PREFIX: '', DEFAULT_USER_PROMPT_SUFFIX: '', DEFAULT_AI_MODEL: 'claude-haiku-4-5',
        JEV_DEFAULT_THRESHOLD: 0.5,
        providerForModel: () => 'anthropic',
        getTasteContext: async () => 'TASTE',
        logToPageConsole: (tab, ...a) => log.page.push(a.join(' ')),
        callLLM: async () => { log.llm++; return '<Negative>bad sentence</Negative>'; },
        extractNegativeTags: t => (t.match(/<Negative>(.*?)<\/Negative>/g) || []).map(s => s.replace(/<\/?Negative>/g, '')),
        classifyTweetsWithJev: async args => {
            log.jev.push(args);
            return args.tweets.map((t, i) => ({ tweet: t, score: jevScores[i], hide: jevScores[i] >= args.threshold }));
        },
        addSuggestionsToBlocklist: async (s, tab, w, d, source) => log.added.push({ s, source: source || 'ai_continuous' }),
        triggerPageBlock: () => { log.triggered++; }
    };
    vm.createContext(box);
    vm.runInContext(code + '\n;globalThis.__h = handleNewContent;', box);
    await box.__h('combined text of the batch', 3, tweets);
    return log;
}
const T = [{ text: 'first tweet', handle: '@a' }, { text: 'second tweet', handle: '@b' }, { text: 'third', handle: '@c' }];

(async () => {
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', anthropicApiKey: 'a', customSystemPrompt: 'MY RULES' }, T, [0.9, 0.2, 0.5]);
        check(l.jev.length === 1 && l.llm === 0, 'X + Jev selected -> Jev only, no text model', JSON.stringify({ jev: l.jev.length, llm: l.llm }));
        check(l.jev[0].systemPrompt === 'MY RULES' && l.jev[0].tasteContext === 'TASTE' && l.jev[0].typesafeApiKey === 'k', 'Jev gets your rules, taste profile and key');
        check(l.jev[0].threshold === 0.5, 'default threshold 0.5');
        check(l.added.length === 1 && l.added[0].source === 'jev' && l.added[0].s.join('|') === 'first tweet|third', 'tweets at/above threshold hidden as whole tweets, source jev', JSON.stringify(l.added));
        check(l.triggered === 1, 'blocker re-applied after the Jev scan');
        check(l.page.some(p => /Jev scored 3 tweet\(s\); hiding 2/.test(p)), 'page console shows the Jev summary', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', jevThreshold: 0.8 }, T, [0.9, 0.2, 0.5]);
        check(l.jev[0].threshold === 0.8 && l.added[0].s.join('|') === 'first tweet', 'custom threshold respected');
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k' }, T, [0.1, 0.2, 0.3]);
        check(l.added.length === 0 && l.triggered === 1, 'nothing over threshold -> nothing added, blocker still re-applied');
    }
    {
        const l = await run({ xEngine: 'llm', anthropicApiKey: 'a', typesafeApiKey: 'k' }, T, []);
        check(l.jev.length === 0 && l.llm === 1, 'X + text model selected -> text model only');
        check(l.added.length === 1 && l.added[0].s[0] === 'bad sentence' && l.added[0].source === 'ai_continuous', 'text model path unchanged');
    }
    {
        const l = await run({ xEngine: 'jev', anthropicApiKey: 'a', typesafeApiKey: 'k' }, [], []);
        check(l.jev.length === 0 && l.llm === 1, 'other sites (no per-tweet items) -> text model even with Jev selected');
    }
    {
        const l = await run({ anthropicApiKey: 'a' }, T, []);
        check(l.jev.length === 0 && l.llm === 1, 'never chosen an X engine -> text model (new users unaffected)');
    }
    console.log(`jev routing: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
