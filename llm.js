// llm.js — Forcefield provider abstraction layer.
// Loaded by the service worker (via importScripts) and the popup (via <script>),
// so all model definitions and network calls live in exactly one place.
//
// Selecting a model implicitly selects its provider (claude-* -> Anthropic,
// gemini-* -> Google). callLLM() builds the right request shape, adds prompt
// caching for Anthropic, disables Gemini "thinking", and returns a plain text
// string so callers can keep using extractNegativeTags() unchanged.

// id -> human label. Kept as a plain string map for backward compatibility with
// the dropdown population code, which assigns the value to option.textContent.
const AVAILABLE_AI_MODELS = {
    'claude-haiku-4-5':       'Claude Haiku 4.5 (cheapest, default)',
    'claude-sonnet-4-6':      'Claude Sonnet 4.6 (balanced)',
    'claude-opus-4-8':        'Claude Opus 4.8 (most capable)',
    'gemini-2.5-flash-lite':  'Gemini 2.5 Flash-Lite (cheapest overall)',
    'gemini-3.1-flash-lite':  'Gemini 3.1 Flash-Lite (smarter)'
};
const DEFAULT_AI_MODEL = 'claude-haiku-4-5';

// --- Cost guard ---------------------------------------------------------
// USD per million tokens (July 2026). Cache reads bill ~0.1x input, cache
// writes 1.25x — recordSpend applies those multipliers from response usage.
const MODEL_PRICING = {
    'claude-haiku-4-5':       { input: 1.00,  output: 5.00 },
    'claude-sonnet-4-6':      { input: 3.00,  output: 15.00 },
    'claude-opus-4-8':        { input: 5.00,  output: 25.00 },
    'gemini-2.5-flash-lite':  { input: 0.10,  output: 0.40 },
    'gemini-3.1-flash-lite':  { input: 0.25,  output: 1.50 }
};
const DEFAULT_SPEND_LIMITS = { hourly: 1.00, daily: 2.00 }; // USD

// Rolling 24h spend log lives in chrome.storage.local under 'aiSpendLog'
// as [{ts, cost}]. Pruned on every read.
async function getSpendState() {
    const { aiSpendLog } = await chrome.storage.local.get(['aiSpendLog']);
    const now = Date.now();
    const log = (aiSpendLog || []).filter(e => now - e.ts < 24 * 3600 * 1000);
    const hourSpend = log.filter(e => now - e.ts < 3600 * 1000).reduce((s, e) => s + e.cost, 0);
    const daySpend = log.reduce((s, e) => s + e.cost, 0);
    return { log, hourSpend, daySpend };
}

async function getSpendLimits() {
    const { spendLimits } = await chrome.storage.sync.get(['spendLimits']);
    return Object.assign({}, DEFAULT_SPEND_LIMITS, spendLimits || {});
}

// Throws (blocking the call) once the accumulated spend reaches a limit.
// Enforcement is on past spend, so a single call can overshoot slightly.
async function enforceBudget() {
    const [{ hourSpend, daySpend }, limits] = await Promise.all([getSpendState(), getSpendLimits()]);
    if (daySpend >= limits.daily) {
        throw new Error(`AI budget: daily limit reached ($${daySpend.toFixed(2)} of $${limits.daily.toFixed(2)}). Scanning pauses until older calls age out of the 24h window.`);
    }
    if (hourSpend >= limits.hourly) {
        throw new Error(`AI budget: hourly limit reached ($${hourSpend.toFixed(2)} of $${limits.hourly.toFixed(2)}). Scanning resumes within the hour.`);
    }
}

async function recordSpend(model, usage) {
    const pricing = MODEL_PRICING[model];
    if (!pricing || !usage) return;
    const effectiveInputTokens =
        (usage.input || 0) +
        1.25 * (usage.cacheWrite || 0) +
        0.10 * (usage.cacheRead || 0);
    const cost = (effectiveInputTokens * pricing.input + (usage.output || 0) * pricing.output) / 1e6;
    const { log } = await getSpendState();
    log.push({ ts: Date.now(), cost: cost });
    await chrome.storage.local.set({ aiSpendLog: log });
}
// --- End cost guard ------------------------------------------------------

function providerForModel(model) {
    return (model && model.indexOf('gemini') === 0) ? 'google' : 'anthropic';
}

// Returns the model's raw text output as a string. Throws on a missing key or a
// non-OK HTTP response (callers already wrap these in try/catch).
async function callLLM({ model, system, userText, maxTokens = 4096, anthropicApiKey, geminiApiKey, cacheSystem = false }) {
    // Guard against a stale/retired model id lingering in storage (e.g. an old
    // claude-3-* selection from before the model list was modernized).
    if (!AVAILABLE_AI_MODELS[model]) {
        console.warn(`[Forcefield] Unknown/stale model "${model}" — falling back to ${DEFAULT_AI_MODEL}.`);
        model = DEFAULT_AI_MODEL;
    }
    const provider = providerForModel(model);

    // Cost guard: refuse the call once the hourly/daily budget is spent.
    await enforceBudget();

    let result;
    if (provider === 'google') {
        if (!geminiApiKey) throw new Error('Gemini API key is not set.');
        result = await callGemini({ model, system, userText, maxTokens, geminiApiKey });
    } else {
        if (!anthropicApiKey) throw new Error('Anthropic API key is not set.');
        result = await callAnthropic({ model, system, userText, maxTokens, anthropicApiKey, cacheSystem });
    }
    // Record actual spend from the response's usage metadata (fire-and-forget;
    // a failed write should never fail the call itself).
    recordSpend(model, result.usage).catch(e => console.warn('[Forcefield] Failed to record AI spend:', e));
    return result.text;
}

async function callAnthropic({ model, system, userText, maxTokens, anthropicApiKey, cacheSystem }) {
    const body = {
        model: model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: userText }]
        // Note: temperature is intentionally omitted. Opus 4.8 (and Fable 5)
        // reject sampling params; tag extraction doesn't need them anyway.
    };
    if (system) {
        // cache_control caches the stable system prefix so repeated scans in a
        // browsing session re-read it at ~10% cost. Only actually caches once the
        // prompt exceeds the model's minimum cacheable length (~2-4K tokens), so
        // it mainly pays off for the large popup prompt / a grown refined prompt.
        body.system = cacheSystem
            ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
            : system;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            // Acknowledges the client-side key exposure; required for direct browser calls.
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const result = await response.json();
    const textBlock = (result.content || []).find(b => b.type === 'text');
    const u = result.usage || {};
    return {
        text: textBlock ? textBlock.text : '',
        usage: {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheWrite: u.cache_creation_input_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0
        }
    };
}

async function callGemini({ model, system, userText, maxTokens, geminiApiKey }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: 0,
            // Flash-Lite supports an adjustable thinking budget; 0 disables it for
            // fast, cheap tag extraction (no reasoning tokens billed).
            thinkingConfig: { thinkingBudget: 0 }
        }
    };
    if (system) {
        body.systemInstruction = { parts: [{ text: system }] };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-goog-api-key': geminiApiKey
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini API failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const result = await response.json();
    const candidate = result.candidates && result.candidates[0];
    const parts = (candidate && candidate.content && candidate.content.parts) || [];
    const u = result.usageMetadata || {};
    return {
        text: parts.map(p => p.text || '').join(''),
        usage: {
            input: u.promptTokenCount || 0,
            output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
            cacheWrite: 0,
            cacheRead: u.cachedContentTokenCount || 0
        }
    };
}

// Parse <Negative>...</Negative> tags out of a model response. Shared by the
// service worker and the popup (both used to carry identical copies).
function extractNegativeTags(text) {
    const regex = /<Negative>(.*?)<\/Negative>/gs;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const suggestion = match[1].trim();
        if (suggestion) {
            matches.push(suggestion);
        }
    }
    return matches;
}

// Belt-and-suspenders export (top-level declarations are already visible to
// other classic scripts in the same realm; this just makes the surface explicit).
self.ForcefieldLLM = {
    AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL, providerForModel, callLLM,
    extractNegativeTags, getSpendState, getSpendLimits, DEFAULT_SPEND_LIMITS, MODEL_PRICING
};

// --- Default prompts (single source of truth for the service worker and the popup) ---
const DEFAULT_SYSTEM_PROMPT = `Your task is to identify:
-Controversial
-Politically aggressive
-Negative
-Low-effort
-Non-technical
-Non-insightful
statements within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger controversial statement.



A taste profile for this specific user follows these instructions, built from posts they liked versus posts they muted or marked not interested. Treat it as the authority on borderline cases: never tag content matching their likes, and lean toward tagging content matching their dislikes, even where the general criteria above are ambiguous.

For each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.
Do NOT add explanations, apologies, or any text outside the <Negative> tags.
Do NOT tag entire paragraphs; the blocking tool only works on single sentences without paragraph breaks or quotation marks.
Be selective and only tag genuinely negative/controversial content, not neutral descriptions or news headlines.

The example below is illustrative and uses invented accounts and posts.

Example Input Text:
To view keyboard shortcuts, press question mark\nView keyboard shortcuts\nFor you\nFollowing\nSee new posts\nWhat's happening?\n\n\nPost\nYour Home Timeline\nCompiler Notes\n@compiler_notes\n·\n1h\nSpent the afternoon reading the allocator source instead of guessing at the profiler output. Turns out the slow path was a fallback we added years ago and never revisited.\n12\n9\n75\n1.3K\nQuiet Mornings\n@quiet_mornings_\n·\n16h\nThere is an old story where a student asks the teacher where all the heroes went, and the teacher answers that the student is the one they have been waiting for.\nQuote\nJournal Digest\n@journal_digest\n·\n4h\nA paper in a materials science journal describes a partial fossil skeleton recovered from a mid-Jurassic formation, representing a taxon not previously described. https://example.com/paper\n3\n12\n5.2K\nDaily Outrage\n@daily_outrage_\n·\n27m\nAbsolutely disgusting that nobody in this industry has the spine to say what everyone privately admits, and the people defending it are either liars or fools.\n127\n264\n1.2K\n409K\nSignal Boost\n@signalboost_x\n·\n55m\nAn anonymous source says a major executive tells the public everything is fine but privately expects something catastrophic.\n52\n181\n4.2K\n142K\nBenchmarks Weekly\n@benchmarks_wk\n·\n34m\nIntroducing a small, scalable benchmark for evaluating planning, constraint adherence, and long-context reasoning.\nShow more\n7\n13\n86\n3.8K\nvague poster\n@vague_poster\n·\n\n16\n45\n918\n28K\nTake Factory\n@take_factory\n·\nMay 29\ncan you upset an entire fandom with one sentence\n57\n22\n676\n32K

Example Correct Output:
<Negative>Absolutely disgusting that nobody in this industry has the spine to say what everyone privately admits</Negative>
<Negative>the people defending it are either liars or fools</Negative>
<Negative>An anonymous source says a major executive tells the public everything is fine but privately expects something catastrophic</Negative>
<Negative>can you upset an entire fandom with one sentence</Negative>`;

const DEFAULT_USER_PROMPT_PREFIX = `Analyze the following text content and extract controversial, politically aggressive, non-technical, low-effort, non-insightful, or negative statements using <Negative> tags as instructed. Judge each statement against this user's taste profile as well as the general criteria:\n\n----\n`;
const DEFAULT_USER_PROMPT_SUFFIX = `\n----\n\nRemember to only return the tagged statements, nothing else.`; // Suffix remains constant for now

Object.assign(self.ForcefieldLLM, { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_PREFIX, DEFAULT_USER_PROMPT_SUFFIX });
