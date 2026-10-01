// Runs the REAL taste-context code from background.js (the block from
// TASTE_SUMMARY_TRIGGER_CHARS through updateTasteSummary) in a sandbox with
// fake chrome.storage and a fake callLLM that records the exact prompt.
// Usage: node tests/taste-context/test.js [path/to/background.js]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bgPath = process.argv[2] || path.join(__dirname, '..', '..', 'background.js');
const src = fs.readFileSync(bgPath, 'utf8');
const start = src.indexOf('const TASTE_SUMMARY_TRIGGER_CHARS');
const fnStart = src.indexOf('async function updateTasteSummary');
let depth = 0, end = -1;
for (let i = src.indexOf('{', src.indexOf(')', fnStart)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (start < 0 || fnStart < 0 || end < 0) { console.log('Could not find taste code in', bgPath); process.exit(1); }
const code = src.slice(start, end) +
    '\n;globalThis.__api = { getTasteContext, updateTasteSummary, TASTE_SUMMARY_PLACEHOLDER, formatActivityExamples };';

// Real model helpers from llm.js (textModelFor), loaded in their own sandbox.
const REAL_LLM = (() => {
    const box = { self: {}, console: { log() {}, warn() {} } };
    vm.createContext(box);
    vm.runInContext(fs.readFileSync(path.join(path.dirname(bgPath), 'llm.js'), 'utf8'), box);
    return box.self.ForcefieldLLM;
})();

let pass = 0, fail = 0;
function check(cond, name, detail) {
    if (cond) pass++;
    else { fail++; console.log('  FAIL', name + (detail ? ' :: ' + detail : '')); }
}

function makeSandbox(local, sync) {
    const calls = [];
    const box = {
        console: { log() {}, warn() {} },
        chrome: { storage: {
            local: { get: async keys => pick(local, keys), set: async obj => Object.assign(local, JSON.parse(JSON.stringify(obj))) },
            sync: { get: async keys => pick(sync, keys) }
        } },
        DEFAULT_AI_MODEL: 'claude-haiku-4-5',
        textModelFor: REAL_LLM.textModelFor,
        providerForModel: m => (m.startsWith('gemini') ? 'google' : 'anthropic'),
        callLLM: async args => { calls.push(args); return FAKE_PROFILE; }
    };
    box.globalThis = box;
    vm.createContext(box);
    vm.runInContext(code, box);
    return { api: box.__api, calls };
}
function pick(obj, keys) {
    const r = {};
    (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in obj) r[k] = JSON.parse(JSON.stringify(obj[k])); });
    return r;
}

// A profile the fake model "returns": right structure, ~400 words.
const FAKE_PROFILE = "A previous summary of the user's likes (important not to block)\n- " + 'word '.repeat(200) +
    "\n\nA previous summary of the user's dislikes (important to block)\n- " + 'word '.repeat(200);

// One entry per category, timestamps interleaved so recency order is testable.
let t = 0;
const entry = (handle, text) => ({ text, handle, displayName: handle.slice(1), url: '', ts: new Date(Date.UTC(2026, 8, 1, 0, 0, t++)).toISOString() });
function activity() {
    t = 0;
    return {
        liked: [entry('@like1', 'a liked post one'), entry('@like2', 'a liked post two')],
        badBlock: [entry('@bad1', 'post the filter wrongly hid')],
        notInterested: [entry('@ni1', 'not interested post')],
        muted: [entry('@mute1', 'muted account post')],
        blocked: [entry('@blk1', 'blocked account post')],
        goodBlock: [entry('@good1', 'post the filter rightly hid')]
    };
}
const line = (tag, handle, text) => `- [${tag}] ${handle}: ${text}`;
const TAG = {
    liked: 'liked', bad: 'Forcefield verdict: should NOT have been hidden',
    ni: 'not interested', muted: 'muted', blocked: 'blocked', good: 'Forcefield verdict: RIGHT to hide'
};

(async () => {
    // 1. Taste context: every example tagged, verdicts on the right side.
    {
        const local = { twitterActivity: activity() };
        const before = JSON.stringify(local.twitterActivity);
        const { api } = makeSandbox(local, {});
        const ctx = await api.getTasteContext();
        const [doNot, doFlag] = [ctx.indexOf('do-NOT-flag side'), ctx.indexOf('DO-flag side')];
        check(doNot > 0 && doFlag > doNot, 'context has both sides in order');
        const notSide = ctx.slice(doNot, doFlag), flagSide = ctx.slice(doFlag);
        check(notSide.includes(line(TAG.liked, '@like1', 'a liked post one')), 'like tagged [liked]');
        check(notSide.includes(line(TAG.bad, '@bad1', 'post the filter wrongly hid')), 'Bad block tagged as verdict on do-NOT side');
        check(flagSide.includes(line(TAG.good, '@good1', 'post the filter rightly hid')), 'Good block tagged as verdict on DO side');
        check(flagSide.includes(line(TAG.ni, '@ni1', 'not interested post')), 'not interested tagged');
        check(flagSide.includes(line(TAG.muted, '@mute1', 'muted account post')), 'mute tagged');
        check(flagSide.includes(line(TAG.blocked, '@blk1', 'blocked account post')), 'block tagged');
        check(!notSide.includes('@good1') && !flagSide.includes('@bad1'), 'verdicts never on the wrong side');
        const exampleLines = ctx.split('\n').filter(l => /^- @|^- \[/.test(l));
        check(exampleLines.length === 7 && exampleLines.every(l => l.startsWith('- [')), 'every example line carries a tag', exampleLines.length + ' lines');
        check(ctx.includes('Forcefield corrections:') && ctx.includes('Forcefield confirmations:'), 'placeholder profile has both Forcefield bullets');
        check(JSON.stringify(local.twitterActivity) === before, 'stored activity not modified (tags are view-only)');
    }

    // 2. Recency: only the 5 newest per side, verdicts compete fairly with likes.
    {
        const a = activity();
        for (let i = 0; i < 6; i++) a.liked.push(entry('@newlike' + i, 'newer like ' + i));
        const { api } = makeSandbox({ twitterActivity: a }, {});
        const ctx = await api.getTasteContext();
        const notSide = ctx.slice(ctx.indexOf('do-NOT-flag side'), ctx.indexOf('DO-flag side'));
        check(!notSide.includes('@bad1'), 'older Bad block drops out when 5 newer likes exist');
        check(notSide.includes('@newlike5') && notSide.includes('@newlike1') && !notSide.includes('@newlike0'), 'exactly the 5 newest kept');
        a.badBlock.push(entry('@bad2', 'fresh wrong hide'));
        const ctx2 = await makeSandbox({ twitterActivity: a }, {}).api.getTasteContext();
        check(ctx2.includes(line(TAG.bad, '@bad2', 'fresh wrong hide')), 'a fresh Bad block appears in the next scan');
    }

    // 3. Empty activity and no profile: no context at all.
    {
        const { api } = makeSandbox({}, {});
        check((await api.getTasteContext()) === '', 'no activity, no profile -> empty context');
    }

    // 4. Profile regeneration prompt: tags explained, verdicts included, new bullets required.
    {
        const local = { twitterActivity: activity() };
        const { api, calls } = makeSandbox(local, { anthropicApiKey: 'test-key-not-real', selectedAiModel: 'claude-haiku-4-5' });
        const res = await api.updateTasteSummary({ force: true });
        check(res.status === 'updated', 'forced regeneration succeeds', JSON.stringify(res));
        check(calls.length === 1, 'model called once');
        const { system, userText } = calls[0] || {};
        check(system.includes('- Forcefield corrections:') && system.includes('- Forcefield confirmations:'), 'summary prompt requires both Forcefield bullets');
        check(system.includes('[Forcefield verdict: ...]') && system.includes('not necessarily that they enjoyed it'), 'summary prompt explains what verdicts mean');
        check(userText.includes(line(TAG.bad, '@bad1', 'post the filter wrongly hid')), 'summary input has tagged Bad block');
        check(userText.includes(line(TAG.good, '@good1', 'post the filter rightly hid')), 'summary input has tagged Good block');
        check(userText.includes(line(TAG.liked, '@like2', 'a liked post two')) && userText.includes(line(TAG.muted, '@mute1', 'muted account post')), 'summary input tags ordinary actions too');
        const notSide = userText.slice(userText.indexOf('do-NOT-block side'), userText.indexOf('DO-block side'));
        check(notSide.includes('@bad1') && !notSide.includes('@good1'), 'summary input keeps verdicts on the right sides');
        check(userText.includes('Forcefield corrections:'), 'first run feeds the new placeholder as the previous profile');
        check(local.tasteSummary && local.tasteSummary.likedCount === 3 && local.tasteSummary.dislikedCount === 4, 'saved counts include verdicts', JSON.stringify(local.tasteSummary && [local.tasteSummary.likedCount, local.tasteSummary.dislikedCount]));
    }

    // 5. Verdict-only history still counts toward the 5-action minimum.
    {
        t = 0;
        const a = { goodBlock: [entry('@g1', 'x'), entry('@g2', 'y'), entry('@g3', 'z')], badBlock: [entry('@b1', 'p'), entry('@b2', 'q')] };
        const { api, calls } = makeSandbox({ twitterActivity: a }, { anthropicApiKey: 'test-key-not-real' });
        const res = await api.updateTasteSummary({ force: true });
        check(res.status === 'updated' && calls.length === 1, 'five verdicts alone are enough to build a profile', JSON.stringify(res));
    }

    console.log(`taste-context: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
