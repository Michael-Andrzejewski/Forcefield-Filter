// LIVE check against the real Jev API, using the real llm.js + jev.js.
// Reads the key from a local file and never prints it.
// Usage: node tests/jev/live.js [path/to/keyfile]   (default: ~/.typesafe-key)
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

const keyFile = process.argv[2] || path.join(os.homedir(), '.typesafe-key');
if (!fs.existsSync(keyFile)) { console.log('No key file at', keyFile); process.exit(2); }
const key = fs.readFileSync(keyFile, 'utf8').trim();

let lastRaw = null;
const box = {
    console, Date, Math, JSON, Promise, self: {},
    chrome: { storage: { local: { get: async () => ({ aiSpendLog: [] }), set: async () => {} }, sync: { get: async () => ({}) } } },
    fetch: async (url, opts) => {
        const t0 = Date.now();
        const r = await fetch(url, opts);
        const text = await r.text();
        lastRaw = { status: r.status, ms: Date.now() - t0, text };
        return { ok: r.ok, status: r.status, statusText: r.statusText, text: async () => text, json: async () => JSON.parse(text) };
    }
};
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(root, 'llm.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'jev.js'), 'utf8') +
    '\n;globalThis.__j = { classifyTweetsWithJev };', box);

// The user's own rules (Sep 25 backup), minus nothing: jev.js strips the format lines itself.
const RULES = `Your task is to identify:
-Excessive profanity used as primary expression rather than emphasis within substantive discussion
-Personal insults, name-calling, and sneering directed at individuals without engaging their ideas
-Apocalyptic framings presented as inevitable without technical grounding or nuance
-Performative outrage or mockery deployed for social signal rather than substantive critique
-Incoherent or unfounded technical claims presented as insight
-Dismissive contempt toward individuals, especially when combined with gloating or condescension

within the provided text content.

Be selective and only tag genuinely hostile, profane, or antagonistically negative content. Do NOT tag good-faith technical discussion, substantive criticism of systems or policies, blunt concern about risks, measured debate on difficult topics, or acknowledgment of problems, even if direct in tone.`;

// Made-up tweets: expected verdict in brackets, for eyeballing only.
const TWEETS = [
    ['@compiler_notes', 'Spent the afternoon reading the allocator source instead of guessing at the profiler output. The slow path was a fallback we added years ago.', 'keep'],
    ['@daily_outrage_', 'Absolutely disgusting that nobody in this industry has the spine to say it, and the people defending it are either liars or fools.', 'hide'],
    ['@doom_poster', "It's over. AGI next year, everyone dies, nothing can be done, stop pretending otherwise.", 'hide'],
    ['@safety_researcher', 'I am genuinely worried that our evals miss deceptive behaviour under distribution shift. Here is a concrete failure case we found.', 'keep'],
    ['@take_factory', 'lmao imagine still thinking this guy has a single original thought. pathetic, ratio incoming', 'hide'],
    ['@policy_wonk', 'The new bill has a real flaw: it defines frontier models by compute alone, which will age badly as efficiency improves.', 'keep'],
    ['@angry_dev', 'This f***ing API is f***ing garbage and whoever designed it should be f***ing fired', 'hide'],
    ['@quiet_mornings_', 'Went for a walk before work. The fog over the river was beautiful.', 'keep'],
    ['@grifter', 'Quantum blockchain AI will make transformers obsolete by Q3, trust me, I have sources at every lab.', 'hide'],
    ['@blunt_reviewer', "Bluntly: this paper's main result doesn't replicate, and the authors should retract the headline claim.", 'keep']
];

(async () => {
    const t0 = Date.now();
    let results;
    try {
        results = await box.__j.classifyTweetsWithJev({
            tweets: TWEETS.map(([handle, text]) => ({ handle, text })),
            systemPrompt: RULES, tasteContext: '', typesafeApiKey: key
        });
    } catch (e) {
        console.log('REQUEST FAILED:', e.message.replace(key, '<key>'));
        if (lastRaw) console.log('HTTP', lastRaw.status, 'body:', lastRaw.text.replace(key, '<key>').slice(0, 600));
        process.exit(1);
    }
    console.log(`HTTP ${lastRaw.status} in ${lastRaw.ms} ms (total ${Date.now() - t0} ms)`);
    const raw = JSON.parse(lastRaw.text);
    console.log('response keys:', Object.keys(raw).join(', '), '| model:', raw.model, '| usage:', JSON.stringify(raw.usage));
    console.log('sample answer:', JSON.stringify(raw.answers && raw.answers.t0));
    let agree = 0;
    results.forEach((r, i) => {
        const expected = TWEETS[i][2];
        const got = r.hide ? 'hide' : 'keep';
        if (got === expected) agree++;
        console.log(`${r.score === null ? '  ?  ' : r.score.toFixed(3)}  ${got.padEnd(4)} (expected ${expected})  ${TWEETS[i][0]}: ${TWEETS[i][1].slice(0, 70)}`);
    });
    const cost = (raw.usage && raw.usage.input_tokens || 0) * 0.042 / 1e6;
    console.log(`agreement with expected: ${agree}/${TWEETS.length} | cost of this call: $${cost.toFixed(6)}`);
})();
