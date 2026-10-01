// jev.js — per-tweet classification with TypeSafe's Jev (a "System One"
// model: it returns typed decisions with probabilities, never text).
// Loaded by the service worker via importScripts, after llm.js (uses
// enforceBudget / recordSpend from there).
//
// Shape of a request: the user's filter rules and taste profile go in
// `state` once; each tweet is its own yes/no ("noul") question carrying the
// tweet inside its instructions. TypeSafe scores every question
// independently, so batching many tweets in one request gives the same
// answers as one request each, at a fraction of the cost.
// Docs: https://docs.typesafe.ai/api.md, /primitives/noul.md

const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const JEV_DEFAULT_THRESHOLD = 0.5;  // noul >= this -> hide
const JEV_MAX_TWEETS_PER_REQUEST = 25;
const JEV_MAX_TWEET_CHARS = 1500;

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
            type: 'noul',
            instructions: {
                tweet: { author: t.handle || '(unknown)', text: String(t.text || '').slice(0, JEV_MAX_TWEET_CHARS) },
                question: 'Should `tweet` be hidden from this user, judged by `filter_rules` and `user_taste_profile` in the state?'
            },
            criteria: {
                true: 'The tweet clearly matches what filter_rules or the dislikes / Forcefield confirmations in user_taste_profile say to hide.',
                false: 'Good-faith, substantive, neutral, or merely blunt content, or anything matching the likes / Forcefield corrections in user_taste_profile.'
            }
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
    recordSpend(JEV_MODEL, { input: u.input_tokens || 0, output: 0 })
        .catch(e => console.warn('[Forcefield] Failed to record Jev spend:', e));
    return { answers: result.answers || {}, usage: u, model: result.model };
}

// Scores every tweet. Returns [{ tweet, score, hide }] in input order; a
// tweet whose answer is missing gets score null and is never hidden.
async function classifyTweetsWithJev({ tweets, systemPrompt, tasteContext, typesafeApiKey, threshold, fetchImpl }) {
    const cut = typeof threshold === 'number' ? threshold : JEV_DEFAULT_THRESHOLD;
    const out = [];
    for (let start = 0; start < tweets.length; start += JEV_MAX_TWEETS_PER_REQUEST) {
        const chunk = tweets.slice(start, start + JEV_MAX_TWEETS_PER_REQUEST);
        const request = buildJevRequest({ tweets: chunk, systemPrompt, tasteContext });
        const { answers } = await callJev({ request, typesafeApiKey, fetchImpl });
        chunk.forEach((tweet, i) => {
            const a = answers['t' + i];
            const score = a && typeof a.noul === 'number' ? a.noul : null;
            out.push({ tweet, score, hide: score !== null && score >= cut });
        });
    }
    return out;
}
