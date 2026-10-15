// Runs the REAL handleNewContent + scanTweetsWithJev from background.js with
// every dependency stubbed, and checks which engine each scan goes to and
// which ratings reach the blocklist.
// Usage: node tests/jev/routing.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8');
const llmSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'llm.js'), 'utf8');

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

// jevSeverities: the 0-10 rating the fake Jev gives each tweet (null = no answer).
async function run(sync, tweets, jevSeverities, llmReply = '<Negative severity="6">bad sentence</Negative>\n<Negative>unrated sentence</Negative>') {
    const log = { llm: [], jev: [], added: [], triggered: 0, page: [] };
    const box = {
        console: { log() {}, warn() {}, error() {} },
        chrome: { storage: {
            sync: { get: async () => sync },
            local: { get: async k => (k.includes('blockList') ? { blockList: [{ text: 'x', level: 8 }] } : { whiteboxMode: true, debugMode: false }) }
        } },
        DEFAULT_SYSTEM_PROMPT: 'default rules', DEFAULT_USER_PROMPT_PREFIX: '', DEFAULT_USER_PROMPT_SUFFIX: '', DEFAULT_AI_MODEL: 'claude-haiku-4-5',
        providerForModel: () => 'anthropic',
        getTasteContext: async () => 'TASTE',
        logToPageConsole: (tab, ...a) => log.page.push(a.map(x => Array.isArray(x) ? x.join(' | ') : x).join(' ')),
        callLLM: async args => { log.llm.push(args); return llmReply; },
        classifyTweetsWithJev: async args => {
            log.jev.push(args);
            return args.tweets.map((t, i) => ({ tweet: t, score: null, severity: jevSeverities[i] }));
        },
        addSuggestionsToBlocklist: async (s, tab, w, d, source) => log.added.push({ s, source: source || 'ai_continuous' }),
        triggerPageBlock: () => { log.triggered++; }
    };
    // Real helpers from llm.js (textModelFor, usesJevOnX, the severity scale,
    // extractRatedNegativeTags); the stubs above are restored on top for
    // anything touching the network.
    const stubs = Object.assign({}, box);
    box.self = {};
    vm.createContext(box);
    vm.runInContext(llmSrc, box);
    Object.assign(box, stubs);
    vm.runInContext(code + '\n;globalThis.__h = handleNewContent; globalThis.__sev = SEVERITY_INSTRUCTIONS;', box);
    log.SEVERITY_INSTRUCTIONS = box.__sev;
    await box.__h('combined text of the batch', 3, tweets);
    return log;
}
const T = [{ text: 'first tweet', handle: '@a' }, { text: 'second tweet', handle: '@b' }, { text: 'third', handle: '@c' }];
const texts = added => added[0].s.map(x => typeof x === 'string' ? x : `${x.text}=${x.severity}`).join('|');

(async () => {
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', anthropicApiKey: 'a', customSystemPrompt: 'MY RULES' }, T, [9, 0, 3]);
        check(l.jev.length === 1 && l.llm.length === 0, 'X + Jev selected -> Jev only, no text model', JSON.stringify({ jev: l.jev.length, llm: l.llm.length }));
        check(l.jev[0].systemPrompt === 'MY RULES' && l.jev[0].tasteContext === 'TASTE' && l.jev[0].typesafeApiKey === 'k', 'Jev gets your rules, taste profile and key');
        check(l.added.length === 1 && l.added[0].source === 'jev' && texts(l.added) === 'first tweet=9|third=3', 'every tweet rated 1+ is stored as a whole tweet with its rating; a 0 is not', JSON.stringify(l.added));
        check(l.triggered === 1, 'blocker re-applied after the Jev scan');
        check(l.page.some(p => /Jev rated 3 tweet\(s\); 2 flagged, 2 at or above hide level 3/.test(p)), 'page console: default hide level 3', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', hideThreshold: 8 }, T, [9, 0, 3]);
        check(texts(l.added) === 'first tweet=9|third=3', 'hide level does not change what is stored (the page filters)');
        check(l.page.some(p => /2 flagged, 1 at or above hide level 8/.test(p)), 'page console counts against the saved hide level', l.page.join(' / '));
        check(l.page.some(p => / 9 HIDE  @a first tweet/.test(p) && / 3 keep  @c third/.test(p)), 'per-tweet lines show rating and HIDE/keep at this level', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k' }, T, [0, null, 0]);
        check(l.added.length === 0 && l.triggered === 1, 'nothing rated 1+ -> nothing added, blocker still re-applied');
    }
    {
        const l = await run({ xEngine: 'llm', anthropicApiKey: 'a', typesafeApiKey: 'k', customSystemPrompt: 'MY RULES' }, T, []);
        check(l.jev.length === 0 && l.llm.length === 1, 'X + text model selected -> text model only');
        check(l.added.length === 1 && l.added[0].source === 'ai_continuous' && texts(l.added) === 'bad sentence=6|unrated sentence=null', 'text model tags carry their rating; a tag without one stays unrated', JSON.stringify(l.added));
        const sys = l.llm[0].system;
        check(sys === `MY RULES\n\n${l.SEVERITY_INSTRUCTIONS}\n\nTASTE`, 'system prompt = your rules, then the 1-10 rating rules, then the taste profile', sys.slice(0, 200));
        check(/<Negative severity="6">/.test(sys) && /9-10 Genuinely hateful/.test(sys), 'rating rules name the attribute and the bands');
        check(l.page.some(p => /Flagged 2 statement\(s\); 2 at or above hide level 3/.test(p) && / 6  bad sentence/.test(p) && / \?  unrated sentence/.test(p)), 'page console lists each rating', l.page.join(' / '));
    }
    {
        const l = await run({ anthropicApiKey: 'a', hideThreshold: 7 }, T, [], '<Negative severity="6">six</Negative><Negative severity="9">nine</Negative>');
        check(texts(l.added) === 'six=6|nine=9', 'both stored regardless of level');
        check(l.page.some(p => /Flagged 2 statement\(s\); 1 at or above hide level 7/.test(p)), 'count at level 7', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', anthropicApiKey: 'a', typesafeApiKey: 'k' }, [], []);
        check(l.jev.length === 0 && l.llm.length === 1, 'other sites (no per-tweet items) -> text model even with Jev selected');
    }
    {
        const l = await run({ selectedAiModel: 'jev-latest', typesafeApiKey: 'k', anthropicApiKey: 'a' }, T, [9, 1, 1]);
        check(l.jev.length === 1 && l.llm.length === 0, 'Jev picked in the AI Model dropdown -> Jev on X');
    }
    {
        const l = await run({ selectedAiModel: 'jev-latest', typesafeApiKey: 'k', anthropicApiKey: 'a' }, [], []);
        check(l.jev.length === 0 && l.llm.length === 1, 'Jev picked, other site -> text model');
    }
    {
        const l = await run({ selectedAiModel: 'claude-sonnet-4-6', typesafeApiKey: 'k', anthropicApiKey: 'a' }, T, []);
        check(l.jev.length === 0 && l.llm.length === 1, 'Sonnet picked -> text model on X');
    }
    {
        const l = await run({ anthropicApiKey: 'a' }, T, []);
        check(l.jev.length === 0 && l.llm.length === 1, 'never chosen an X engine -> text model (new users unaffected)');
    }
    console.log(`jev routing: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
