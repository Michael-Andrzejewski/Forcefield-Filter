// Runs the REAL handleNewContent + scanTweetsWithJev from background.js with
// every dependency stubbed, and checks which engine each scan goes to and
// which ratings reach the blocklist.
// Usage: node tests/jev/routing.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'background.js'), 'utf8');
const llmSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'llm.js'), 'utf8');
const goodFaithSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'goodFaith.js'), 'utf8');

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
    const log = { llm: [], jev: [], added: [], triggered: 0, page: [], recorded: [], badFaith: [] };
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
            // Every other tweet is called bad faith, when asked.
            return args.tweets.map((t, i) => ({ tweet: t, score: null, severity: jevSeverities[i], badFaith: args.askFaith ? i % 2 === 0 : null }));
        },
        addSuggestionsToBlocklist: async (s, tab, w, d, source) => log.added.push({ s, source: source || 'ai_continuous' }),
        triggerPageBlock: () => { log.triggered++; },
        blockerHasWork: async blockList => !!(blockList && blockList.length),
        recordBadFaith: async posts => { log.badFaith.push(posts); },
        recordScannedTweets: async texts => { log.recorded.push(texts); }
    };
    // Real helpers from llm.js (textModelFor, usesJevOnX, the severity scale,
    // extractRatedNegativeTags); the stubs above are restored on top for
    // anything touching the network.
    const stubs = Object.assign({}, box);
    box.self = {};
    vm.createContext(box);
    vm.runInContext(llmSrc, box);
    vm.runInContext(goodFaithSrc, box); // real attributeBadFaith
    Object.assign(box, stubs);
    vm.runInContext(code + '\n;globalThis.__h = handleNewContent; globalThis.__sev = SEVERITY_INSTRUCTIONS; globalThis.__faith = FAITH_INSTRUCTIONS;', box);
    log.SEVERITY_INSTRUCTIONS = box.__sev;
    log.FAITH_INSTRUCTIONS = box.__faith;
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
        check(l.jev[0].askFaith === true, 'Jev is asked about bad faith (good-faith mutes on by default)');
        check(JSON.stringify(l.badFaith) === JSON.stringify([[{ handle: '@a', text: 'first tweet' }, { handle: '@c', text: 'third' }]]), 'bad-faith tweets that were flagged go to the ledger', JSON.stringify(l.badFaith));
        check(l.added.length === 1 && l.added[0].source === 'jev' && texts(l.added) === 'first tweet=9|third=3', 'every tweet rated 1+ is stored as a whole tweet with its rating; a 0 is not', JSON.stringify(l.added));
        check(l.triggered === 1, 'blocker re-applied after the Jev scan');
        check(l.page.some(p => /Jev rated 3 tweet\(s\); 2 flagged, 2 at or above hide level 3/.test(p)), 'page console: default hide level 3', l.page.join(' / '));
        check(l.recorded.length === 1 && l.recorded[0].join('|') === 'first tweet|second tweet|third', 'every rated tweet (0 too) recorded as scanned', JSON.stringify(l.recorded));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', hideThreshold: 8 }, T, [9, 0, 3]);
        check(texts(l.added) === 'first tweet=9|third=3', 'hide level does not change what is stored (the page filters)');
        check(l.page.some(p => /2 flagged, 1 at or above hide level 8/.test(p)), 'page console counts against the saved hide level', l.page.join(' / '));
        check(l.page.some(p => / 9 HIDE  \[bad faith\] @a first tweet/.test(p) && / 0 keep  @b second tweet/.test(p) && / 3 keep  \[bad faith\] @c third/.test(p)), 'per-tweet lines show rating, HIDE/keep at this level, and bad faith', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k' }, T, [0, null, 0]);
        check(l.added.length === 0 && l.triggered === 1, 'nothing rated 1+ -> nothing added, blocker still re-applied');
        check(l.recorded[0].join('|') === 'first tweet|third', 'a tweet Jev did not answer is not recorded as scanned', JSON.stringify(l.recorded));
    }
    {
        const l = await run({ xEngine: 'llm', anthropicApiKey: 'a', typesafeApiKey: 'k', customSystemPrompt: 'MY RULES' }, T, []);
        check(l.jev.length === 0 && l.llm.length === 1, 'X + text model selected -> text model only');
        check(l.recorded.length === 1 && l.recorded[0].join('|') === 'first tweet|second tweet|third', 'text model scan records every tweet in the batch', JSON.stringify(l.recorded));
        check(l.added.length === 1 && l.added[0].source === 'ai_continuous' && texts(l.added) === 'bad sentence=6|unrated sentence=null', 'text model tags carry their rating; a tag without one stays unrated', JSON.stringify(l.added));
        const sys = l.llm[0].system;
        check(sys === `MY RULES\n\n${l.SEVERITY_INSTRUCTIONS}\n\n${l.FAITH_INSTRUCTIONS}\n\nTASTE`, 'system prompt = your rules, the 1-10 rating rules, the bad-faith rules, then the taste profile', sys.slice(0, 200));
        check(JSON.stringify(l.badFaith) === '[[]]', 'no faith="bad" tags -> nothing for the ledger', JSON.stringify(l.badFaith));
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
        check(l.recorded.length === 0, 'other sites: nothing recorded');
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
    {
        const l = await run({ anthropicApiKey: 'a', customSystemPrompt: 'MY RULES', goodFaithMutes: false }, T, [], '<Negative severity="7" faith="bad">first tweet</Negative>');
        check(l.llm[0].system === `MY RULES\n\n${l.SEVERITY_INSTRUCTIONS}\n\nTASTE`, 'good-faith mutes off: no bad-faith rules in the prompt', l.llm[0].system.slice(-200));
        check(l.badFaith.length === 0, 'good-faith mutes off: nothing for the ledger');
    }
    {
        const l = await run({ anthropicApiKey: 'a' }, [{ text: 'You are an idiot and you know it, stop posting', handle: '@rude' }, { text: 'Nice careful thread', handle: '@kind' }], [], '<Negative severity="7" faith="bad">You are an idiot and you know it</Negative>');
        check(JSON.stringify(l.badFaith) === JSON.stringify([[{ handle: '@rude', text: 'You are an idiot and you know it, stop posting' }]]), 'faith="bad" tag pinned on the tweet it came from', JSON.stringify(l.badFaith));
        check(l.page.some(p => / 7  \[bad faith\] You are an idiot/.test(p)), 'page console marks bad-faith tags', l.page.join(' / '));
    }
    {
        const l = await run({ xEngine: 'jev', typesafeApiKey: 'k', goodFaithMutes: false }, T, [9, 0, 3]);
        check(l.jev[0].askFaith === false && l.badFaith.length === 0, 'good-faith mutes off: Jev not asked, nothing recorded');
    }
    console.log(`jev routing: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
