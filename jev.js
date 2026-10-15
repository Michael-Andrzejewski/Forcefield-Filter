// jev.js — per-tweet classification with TypeSafe's Jev (a "System One"
// model: it returns typed decisions with probabilities, never text).
// Loaded by the service worker via importScripts, after llm.js (uses
// enforceBudget / recordSpend / SEVERITY_BANDS from there).
//
// Shape of a request: the user's filter rules and taste profile go in
// `state` once; each tweet is its own "score" question carrying the tweet
// inside its instructions. TypeSafe scores every question independently, so
// batching many tweets in one request gives the same answers as one request
// each, at a fraction of the cost.
// Docs: https://docs.typesafe.ai/api.md, /primitives/score.md

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const JEV_MAX_TWEETS_PER_REQUEST = 25;
const JEV_MAX_TWEET_CHARS = 1500;

// Score levels, low to high: "nothing to hide", then the five severity
// bands from llm.js. Jev answers a probability-weighted level from 0 to 5,
// which maps linearly onto severity 0-10 (each band's level lands on the top
// of its band: Mildly unwanted -> 2, Genuinely hateful -> 10).
const JEV_SCORE_LEVELS = [
    'Nothing this user would mind: good-faith, substantive, neutral, or merely blunt content, or anything matching the likes or Forcefield corrections in user_taste_profile.'
].concat(SEVERITY_BANDS.map(b => `${b.label}: ${b.text}.`));

// Jev's 0..levels-1 score -> severity 0-10 (0 means not flagged).
function jevSeverity(score) {
    if (typeof score !== 'number' || !isFinite(score)) return null;
    const top = JEV_SCORE_LEVELS.length - 1;
    return Math.min(10, Math.max(0, Math.round(score / top * 10)));
}

// The system prompt is written for a text model that tags sentences. Keep
// the part that says WHAT to hide; drop output-format rules and the worked
// example, which mean nothing to a model that only answers questions.
function jevFilterRules(systemPrompt) {
    let p = String(systemPrompt || '');
    const ex = p.search(/^\s*(The example below|Example Input Text:)/m);
    if (ex >= 0) p = p.slice(0, ex);
    return p.split('\n')
        .filter(line => !/<Negative>|Do NOT add explanations|Do NOT tag entire paragraphs|blocking tool only works/i.test(line))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// tweets: [{ text, handle }] -> { model, state, questions } with keys t0..tN.
function buildJevRequest({ tweets, systemPrompt, tasteContext }) {
    const state = {
        task: "You are this user's personal content filter for X (Twitter). For each tweet asked about, decide whether the user would want it hidden from their feed.",
        filter_rules: jevFilterRules(systemPrompt),
        user_taste_profile: tasteContext || '(no taste profile yet: rely on filter_rules alone)'
    };
    const questions = {};
    tweets.forEach((t, i) => {
        questions['t' + i] = {
            type: 'score',
            instructions: {
                tweet: { author: t.handle || '(unknown)', text: String(t.text || '').slice(0, JEV_MAX_TWEET_CHARS) },
                question: 'How much would this user want `tweet` hidden from their feed, judged by `filter_rules` and `user_taste_profile` in the state?'
            },
            criteria: JEV_SCORE_LEVELS
        };
    });
    return { model: JEV_MODEL, state, questions };
}

// One HTTP call. Returns { answers, usage }. Throws on HTTP errors, with
// the status in the message (401 bad key, 422 bad request, 429/529 busy).
async function callJev({ request, typesafeApiKey, fetchImpl }) {
    if (!typesafeApiKey) throw new Error('TypeSafe API key is not set.');
    await enforceBudget();
    const response = await (fetchImpl || fetch)(JEV_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + typesafeApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Jev API failed: ${response.status} ${response.statusText} - ${body.slice(0, 300)}`);
    }
    const result = await response.json();
    const u = result.usage || {};
    recordSpend(JEV_MODEL, { input: u.input_tokens || 0, output: 0 }, Object.keys(request.questions || {}).length)
        .catch(e => console.warn('[Forcefield] Failed to record Jev spend:', e));
    return { answers: result.answers || {}, usage: u, model: result.model };
}

// Rates every tweet. Returns [{ tweet, score, severity }] in input order:
// score is Jev's raw level (0-5), severity the 0-10 rating. A tweet whose
// answer is missing gets null for both and is never hidden.
async function classifyTweetsWithJev({ tweets, systemPrompt, tasteContext, typesafeApiKey, fetchImpl }) {
    const out = [];
    for (let start = 0; start < tweets.length; start += JEV_MAX_TWEETS_PER_REQUEST) {
        const chunk = tweets.slice(start, start + JEV_MAX_TWEETS_PER_REQUEST);
        const request = buildJevRequest({ tweets: chunk, systemPrompt, tasteContext });
        const { answers } = await callJev({ request, typesafeApiKey, fetchImpl });
        chunk.forEach((tweet, i) => {
            const a = answers['t' + i];
            const score = a && typeof a.score === 'number' ? a.score : null;
            out.push({ tweet, score, severity: jevSeverity(score) });
        });
    }
    return out;
}
