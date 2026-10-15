// The 1-10 severity scale: tag parsing and Hide level helpers from llm.js, and
// the REAL addSuggestionsToBlocklist from background.js with fake storage.
// Usage: node tests/severity/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');
const llmSrc = fs.readFileSync(path.join(root, 'llm.js'), 'utf8');
const bgSrc = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

function extract(sig) {
    const start = bgSrc.indexOf(sig);
    if (start < 0) throw new Error('missing ' + sig);
    let depth = 0;
    for (let i = bgSrc.indexOf('{', bgSrc.indexOf(')', start)); i < bgSrc.length; i++) {
        if (bgSrc[i] === '{') depth++;
        else if (bgSrc[i] === '}') { depth--; if (depth === 0) return bgSrc.slice(start, i + 1); }
    }
}

const box = { self: {}, console: { log() {}, warn() {} } };
vm.createContext(box);
vm.runInContext(llmSrc, box);
const L = box.self.ForcefieldLLM;

// --- Tag parsing ---
{
    const reply = [
        '<Negative severity="7">liars or fools</Negative>',
        "<Negative severity='3'>single quotes</Negative>",
        '<Negative severity=9>no quotes</Negative>',
        '<Negative severity="12">too high</Negative>',
        '<Negative severity="0">too low</Negative>',
        '<Negative severity="4.6">decimal</Negative>',
        '<Negative>no rating</Negative>',
        '<Negative severity="high">junk rating</Negative>',
        '<Negative severity="5">   </Negative>',
        '<Negative  SEVERITY = "6" >spaced\nacross lines</Negative>'
    ].join('\n');
    const got = L.extractRatedNegativeTags(reply);
    const want = [
        ['liars or fools', 7], ['single quotes', 3], ['no quotes', 9], ['too high', 10], ['too low', 1],
        ['decimal', 5], ['no rating', null], ['junk rating', null], ['spaced\nacross lines', 6]
    ];
    check(JSON.stringify(got.map(t => [t.text, t.severity])) === JSON.stringify(want), 'ratings parsed, clamped to 1-10, missing or junk -> null, empty tags dropped', JSON.stringify(got));
    check(L.extractNegativeTags(reply).join('|') === want.map(w => w[0]).join('|'), 'extractNegativeTags still returns just the texts (popup AI Suggestions)');
    check(L.extractRatedNegativeTags('').length === 0 && L.extractRatedNegativeTags(undefined).length === 0, 'empty reply -> no tags');
    check(L.extractNegativeTags('<Negative>old style</Negative>')[0] === 'old style', 'old untagged format still parsed');
}

// --- Hide level helpers ---
{
    check(L.DEFAULT_HIDE_THRESHOLD === 3, 'default hide level is 3');
    const from = [undefined, null, '', 'junk', 0, 1, '4', 5.4, 10, 11, -2].map(L.hideThresholdFrom).join(',');
    check(from === '3,3,3,3,1,1,4,5,10,10,1', 'hideThresholdFrom: default for unset/junk, rounds and clamps', from);
    const list = [{ text: 'a', severity: 2 }, { text: 'b', severity: 3 }, { text: 'c' }, { text: 'd', severity: null }];
    check(L.entriesToHide(list, 3).map(i => i.text).join('') === 'bcd', 'entriesToHide: at or above the level, plus unrated');
    check(L.entriesToHide(undefined, 3).length === 0, 'entriesToHide: no list -> empty');
    const lines = Array.from({ length: 10 }, (_, i) => L.describeHideThreshold(i + 1));
    check(lines[0] === 'Hides everything flagged, even mildly unwanted posts.', 'label at 1', lines[0]);
    check(lines[1] === 'Hides 2-10: mildly unwanted and worse. Shows 1.', 'label at 2', lines[1]);
    check(lines[2] === 'Hides 3-10: clearly unwanted and worse. Shows 1-2.', 'label at 3', lines[2]);
    check(lines[4] === 'Hides 5-10: negative or divisive and worse. Shows 1-4.', 'label at 5', lines[4]);
    check(lines[6] === 'Hides 7-10: hostile and worse. Shows 1-6.', 'label at 7', lines[6]);
    check(lines[8] === 'Hides 9-10: genuinely hateful only. Shows 1-8.', 'label at 9', lines[8]);
    check(lines[9] === 'Hides 10: genuinely hateful only. Shows 1-9.', 'label at 10', lines[9]);
    const s = L.SEVERITY_INSTRUCTIONS;
    check(['1-2 Mildly unwanted', '3-4 Clearly unwanted', '5-6 Negative or divisive', '7-8 Hostile', '9-10 Genuinely hateful'].every(b => s.includes(b)), 'instructions list all five bands in order');
    check(s.includes('<Negative severity="6">exact text</Negative>') && /including mild cases/.test(s), 'instructions give the format and ask for mild cases too');
    check(L.SEVERITY_BANDS.every((b, i) => b.low === 2 * i + 1 && b.high === 2 * i + 2), 'bands tile 1-10 with no gaps');
    check(/<Negative severity="\d+">/.test(L.DEFAULT_SYSTEM_PROMPT) && !/<Negative>Absolutely/.test(L.DEFAULT_SYSTEM_PROMPT), 'default prompt example shows ratings');
}

// --- Debug view: tweet keys match the page's own normalization ---
{
    const page = { };
    vm.createContext(page);
    vm.runInContext(extract('function normalizeApostrophes') + '\n' + extract('function normalizeText') + '\n;globalThis.__n = normalizeText;', page);
    const samples = [
        'Plain tweet text that is long enough to be cut at sixty characters for the key, yes',
        'It’s “quoted” — with an en–dash, a minus − and an ellipsis…',
        '  Leading space\nand a line break\tand a TAB  ',
        '`backtick` and ´acute´ ‘single’ «guillemets» „low”',
        'Emoji 😀 and CJK 漢字 stay as they are'
    ];
    const same = samples.every(s => L.tweetScanKey(s) === page.__n(s).slice(0, 60));
    check(same, 'tweetScanKey = the page\'s normalizeText, first 60 characters', JSON.stringify(samples.map(s => [L.tweetScanKey(s), page.__n(s).slice(0, 60)])));
    check(L.tweetScanKey('') === '' && L.tweetScanKey(undefined) === '', 'empty text -> empty key');
}

// --- recordScannedTweets ---
async function record(start, texts, { noSession = false } = {}) {
    const session = { scannedTweetKeys: start };
    const warnings = [];
    const b = {
        console: { log() {}, warn: (...a) => warnings.push(a.join(' ')) },
        tweetScanKey: L.tweetScanKey,
        chrome: { storage: noSession ? {} : { session: {
            get: async () => ({ scannedTweetKeys: session.scannedTweetKeys }),
            set: async o => Object.assign(session, JSON.parse(JSON.stringify(o)))
        } } }
    };
    vm.createContext(b);
    vm.runInContext('const SCANNED_KEYS_MAX = 500;\n' + extract('async function recordScannedTweets') + '\n;globalThis.__r = recordScannedTweets;', b);
    await b.__r(texts);
    return { keys: session.scannedTweetKeys, warnings };
}

// --- addSuggestionsToBlocklist ---
async function add(start, suggestions, source) {
    const store = { blockList: JSON.parse(JSON.stringify(start)) };
    const sent = [];
    const b = {
        console: { log() {}, warn() {} },
        getDefaultLevelForSite: () => 8,
        chrome: {
            tabs: { get: async () => ({ url: 'https://x.com/home' }) },
            storage: { local: { get: async () => ({ blockList: store.blockList }), set: async o => { Object.assign(store, JSON.parse(JSON.stringify(o))); store.writes = (store.writes || 0) + 1; } } },
            runtime: { sendMessage: m => { sent.push(m); return Promise.resolve(); } }
        }
    };
    vm.createContext(b);
    vm.runInContext(extract('async function addSuggestionsToBlocklist') + '\n;globalThis.__a = addSuggestionsToBlocklist;', b);
    await b.__a(suggestions, 1, true, false, source);
    return { list: store.blockList, writes: store.writes || 0, sent };
}
(async () => {
    {
        const r = await record(undefined, ['First Tweet', 'second  tweet']);
        check(r.keys.join('|') === 'firsttweet|secondtweet', 'scanned tweets recorded as keys', JSON.stringify(r.keys));
        const r2 = await record(['a', 'firsttweet', 'b'], ['First tweet', 'new one']);
        check(r2.keys.join('|') === 'a|b|firsttweet|newone', 'a re-scanned tweet moves to the newest end, no duplicates', JSON.stringify(r2.keys));
        const many = Array.from({ length: 600 }, (_, i) => 'tweet ' + i);
        const r3 = await record([], many);
        check(r3.keys.length === 500 && r3.keys[0] === 'tweet100' && r3.keys[499] === 'tweet599', 'capped at the newest 500', r3.keys.length + ' ' + r3.keys[0]);
        const r4 = await record(['x'], []);
        check(r4.keys.join('|') === 'x', 'nothing scanned -> unchanged');
        const r5 = await record(undefined, ['t'], { noSession: true });
        check(r5.warnings.length === 0, 'no session storage -> skipped quietly');
    }
    {
        const r = await add([], [{ text: ' rated ', severity: 6 }, { text: 'unrated', severity: null }, 'plain string'], 'ai_continuous');
        check(JSON.stringify(r.list) === JSON.stringify([
            { text: 'rated', level: 8, source: 'ai_continuous', severity: 6 },
            { text: 'unrated', level: 8, source: 'ai_continuous' },
            { text: 'plain string', level: 8, source: 'ai_continuous' }
        ]), 'new entries keep their rating; unrated ones get no severity field', JSON.stringify(r.list));
        check(r.sent.length === 1 && r.sent[0].newSuggestions.length === 3, 'popup told about the 3 new entries');
    }
    {
        const start = [
            { text: 'Old AI flag', level: 8, source: 'ai_continuous' },
            { text: 'jev tweet', level: 8, source: 'jev', severity: 4 },
            { text: 'my phrase', level: 8, source: 'manual' },
            { text: 'selected', level: 8, source: 'manual_select' }
        ];
        const r = await add(start, [{ text: 'old ai flag', severity: 5 }, { text: 'jev tweet', severity: 8 }, { text: 'my phrase', severity: 2 }, { text: 'Selected', severity: 2 }], 'jev');
        check(r.list.length === 4, 'no duplicates added', JSON.stringify(r.list));
        check(r.list[0].severity === 5 && r.list[1].severity === 8, 'AI-made entries take the fresh rating (also rates pre-2.10 flags)', JSON.stringify(r.list));
        check(!('severity' in r.list[2]) && !('severity' in r.list[3]), 'hand-made entries stay unrated, so always hidden', JSON.stringify(r.list));
        check(r.writes === 1, 're-rating is saved');
    }
    {
        const r = await add([{ text: 'same', level: 8, source: 'jev', severity: 4 }], [{ text: 'same', severity: 4 }, { text: 'same', severity: null }], 'jev');
        check(r.writes === 0 && r.list[0].severity === 4, 'same rating or no rating -> nothing written');
    }
    console.log(`severity: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
