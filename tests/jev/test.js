// Offline test of jev.js + llm.js: real code, fake fetch and storage.
// Usage: node tests/jev/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

function sandbox({ spendLog = [], limits } = {}) {
    const local = { aiSpendLog: spendLog };
    const sync = limits ? { spendLimits: limits } : {};
    const fetchCalls = [];
    let reply = null;
    const box = {
        console: { log() {}, warn() {} }, Date, Math, JSON, Promise,
        self: {},
        chrome: { storage: {
            local: { get: async k => ({ aiSpendLog: local.aiSpendLog }), set: async o => Object.assign(local, o) },
            sync: { get: async k => sync }
        } },
        fetch: async (url, opts) => { fetchCalls.push({ url, opts, body: JSON.parse(opts.body) }); return reply(JSON.parse(opts.body)); }
    };
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(root, 'llm.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'jev.js'), 'utf8') +
        '\n;globalThis.__j = { classifyTweetsWithJev, buildJevRequest, jevFilterRules, JEV_DEFAULT_THRESHOLD, DEFAULT_SYSTEM_PROMPT };', box);
    return { j: box.__j, fetchCalls, local, setReply: f => { reply = f; } };
}
const ok = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
// Answers t0..tN with the given scores, usage proportional to size.
const answering = scores => req => ok({
    model: 'jev-1.13.0',
    answers: Object.fromEntries(Object.keys(req.questions).map((k, i) => [k, { type: 'noul', noul: scores[i % scores.length] }])),
    usage: { input_tokens: 1000, output_tokens: 20 }
});

const MY_PROMPT = `Your task is to identify:
-Excessive profanity used as primary expression rather than emphasis within substantive discussion
-Personal insults, name-calling, and sneering directed at individuals without engaging their ideas

within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger hostile statement.

For each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.
Do NOT add explanations, apologies, or any text outside the <Negative> tags.
Do NOT tag entire paragraphs; the blocking tool only works on single sentences without paragraph breaks or quotation marks.
Be selective and only tag genuinely hostile, profane, or antagonistically negative content. Do NOT tag good-faith technical discussion.`;
const tweets = n => Array.from({ length: n }, (_, i) => ({ text: `tweet number ${i} says something`, handle: '@user' + i }));

(async () => {
    // 1. Request shape.
    {
        const { j, fetchCalls, setReply } = sandbox();
        setReply(answering([0.9, 0.1, 0.5]));
        const res = await j.classifyTweetsWithJev({ tweets: tweets(3), systemPrompt: MY_PROMPT, tasteContext: 'TASTE BLOCK', typesafeApiKey: 'test-key-not-real' });
        const c = fetchCalls[0];
        check(fetchCalls.length === 1, 'one request for 3 tweets');
        check(c.url === 'https://api.typesafe.ai/v1/systemone', 'official endpoint', c.url);
        check(c.opts.headers.Authorization === 'Bearer test-key-not-real' && c.opts.method === 'POST', 'bearer auth, POST');
        check(c.body.model === 'jev-latest', 'model jev-latest');
        check(c.body.state.user_taste_profile === 'TASTE BLOCK', 'taste profile sent once in state');
        const rules = c.body.state.filter_rules;
        check(rules.includes('Excessive profanity') && rules.includes('Do NOT tag good-faith technical discussion'), 'filter rules keep what to hide and what to protect');
        check(!/<Negative>|Do NOT add explanations|Do NOT tag entire paragraphs/.test(rules), 'filter rules drop text-model output instructions', rules);
        check(Object.keys(c.body.questions).join(',') === 't0,t1,t2', 'one question per tweet, keys t0..t2');
        const q = c.body.questions.t1;
        check(q.type === 'noul' && q.instructions.tweet.text === 'tweet number 1 says something' && q.instructions.tweet.author === '@user1', 'tweet travels inside its own question');
        check(q.criteria && q.criteria.true && q.criteria.false, 'true/false criteria present');
        check(res.map(r => r.score).join(',') === '0.9,0.1,0.5', 'scores map back in order', JSON.stringify(res.map(r => r.score)));
        check(res.map(r => r.hide).join(',') === 'true,false,true', 'default threshold 0.5 is inclusive');
    }
    // 2. Default prompt: worked example stripped.
    {
        const { j } = sandbox();
        const rules = j.jevFilterRules(j.DEFAULT_SYSTEM_PROMPT);
        check(rules.includes('Politically aggressive') && !rules.includes('Example Input Text') && !rules.includes('Daily Outrage'), 'default prompt: criteria kept, example removed');
    }
    // 3. Threshold and missing answers.
    {
        const { j, setReply } = sandbox();
        setReply(req => ok({ answers: { t0: { type: 'noul', noul: 0.72 } }, usage: { input_tokens: 10 } }));
        const res = await j.classifyTweetsWithJev({ tweets: tweets(2), systemPrompt: MY_PROMPT, typesafeApiKey: 'k', threshold: 0.8 });
        check(res[0].score === 0.72 && res[0].hide === false, 'custom threshold 0.8 keeps a 0.72');
        check(res[1].score === null && res[1].hide === false, 'missing answer is never hidden');
    }
    // 4. Batching: 60 tweets -> 25 + 25 + 10.
    {
        const { j, fetchCalls, setReply } = sandbox();
        setReply(answering([0.6]));
        const res = await j.classifyTweetsWithJev({ tweets: tweets(60), systemPrompt: MY_PROMPT, typesafeApiKey: 'k' });
        check(fetchCalls.map(c => Object.keys(c.body.questions).length).join(',') === '25,25,10', 'chunks of 25 tweets', fetchCalls.map(c => Object.keys(c.body.questions).length).join(','));
        check(res.length === 60 && res[59].tweet.handle === '@user59', 'all 60 results in order');
    }
    // 5. Errors.
    {
        const { j, setReply } = sandbox();
        setReply(() => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '{"error":"invalid key"}' }));
        let err = null;
        try { await j.classifyTweetsWithJev({ tweets: tweets(1), systemPrompt: MY_PROMPT, typesafeApiKey: 'bad' }); } catch (e) { err = e; }
        check(err && /401/.test(err.message), 'HTTP 401 surfaces as an error with the status', err && err.message);
        let err2 = null;
        try { await j.classifyTweetsWithJev({ tweets: tweets(1), systemPrompt: MY_PROMPT, typesafeApiKey: '' }); } catch (e) { err2 = e; }
        check(err2 && /TypeSafe API key is not set/.test(err2.message), 'missing key refused before any request');
    }
    // 6. Spend: recorded at Jev pricing; budget blocks calls.
    {
        const s = sandbox();
        s.setReply(answering([0.1]));
        await s.j.classifyTweetsWithJev({ tweets: tweets(1), systemPrompt: MY_PROMPT, typesafeApiKey: 'k' });
        await new Promise(r => setTimeout(r, 10));
        const last = s.local.aiSpendLog[s.local.aiSpendLog.length - 1];
        check(last && Math.abs(last.cost - 1000 * 0.042 / 1e6) < 1e-12, 'spend = 1000 input tokens x $0.042/M, output free', last && last.cost);
        const b = sandbox({ spendLog: [{ ts: Date.now(), cost: 5 }] });
        b.setReply(answering([0.1]));
        let err = null;
        try { await b.j.classifyTweetsWithJev({ tweets: tweets(1), systemPrompt: MY_PROMPT, typesafeApiKey: 'k' }); } catch (e) { err = e; }
        check(err && /budget/i.test(err.message) && b.fetchCalls.length === 0, 'spend limit reached -> no request sent', err && err.message);
    }
    console.log(`jev: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
