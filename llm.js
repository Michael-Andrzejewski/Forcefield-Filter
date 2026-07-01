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
    if (provider === 'google') {
        if (!geminiApiKey) throw new Error('Gemini API key is not set.');
        return callGemini({ model, system, userText, maxTokens, geminiApiKey });
    }
    if (!anthropicApiKey) throw new Error('Anthropic API key is not set.');
    return callAnthropic({ model, system, userText, maxTokens, anthropicApiKey, cacheSystem });
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
    return textBlock ? textBlock.text : '';
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
    return parts.map(p => p.text || '').join('');
}

// Belt-and-suspenders export (top-level declarations are already visible to
// other classic scripts in the same realm; this just makes the surface explicit).
self.ForcefieldLLM = { AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL, providerForModel, callLLM };

// --- Default prompts (single source of truth for the service worker and the popup) ---
const DEFAULT_SYSTEM_PROMPT = `Your task is to identify:
-Controversial
-Politically aggressive
-Negative
-Low-effort
-Non-technical
-Non-insightful
statements within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger controversial statement.



For each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.
Do NOT add explanations, apologies, or any text outside the <Negative> tags.
Do NOT tag entire paragraphs; the blocking tool only works on single sentences without paragraph breaks or quotation marks.
Be selective and only tag genuinely negative/controversial content, not neutral descriptions or news headlines.

Example Input Text:
To view keyboard shortcuts, press question mark\nView keyboard shortcuts\nFor you\nFollowing\nSee new posts\nWhat's happening?\n\n\nPost\nYour Home Timeline\nJoshua Skootsky\n@Joshua_Skootsky\n·\n1h\nThere is a beautiful song where the author turns to Rabbi Akiva and asks where are the heroes, where are the Maccabees?\n\nThe teacher, Rabbi Akiva, says you are the heroes, you are the Maccabees.\nQuote\nEmmett Shear\n@eshear\n·\n16h\nI have good news, and I have bad news.\nThe good news is: the cavalry is coming. We are saved. The crisis will be resolved. The problem will be solved.\nThe bad news is: if you are reading this, you're the cavalry.\n2\n1\n75\nEmmett Shear\n@eshear\n·\n38m\nIs it Rabbi Akiva by Debbie Friedman?\nopen.spotify.com\nRabbi Akiva\nDebbie Friedman · The Alef Bet · Song · 2001\n1\n30\nLisan al Gaib\n@scaling01\n·\n55m\nIntroducing LisanBench\n\nLisanBench is a simple, scalable, and precise benchmark designed to evaluate large language models on knowledge, forward-planning, constraint adherence, memory and attention, and long context reasoning and "stamina".\n\n"I see possible futures, all at once.\nShow more\n7\n13\n86\n3.8K\nMinh Nhat Nguyen\n@menhguin\n·\n27m\nyou should def look at the Alternate Uses Test and Divergent Association Tests which are common tests for creativity\n22\nNature Portfolio\n@NaturePortfolio\n·\n4h\nA paper in \n@SciReports\n describes a partial skeleton collected from the Middle Jurassic Xinhe Formation of Gansu Province in China that represents a new taxon of non-neosauropod eusauropods and was named Jinchuanloong niedu. https://go.nature.com/3Hx9y3O\n3\n12\n5.2K\nxjdr\n@_xjdr\n·\n46m\nrust is not well represented in the training data of the current SOTA models but i am becoming increasingly convinced it is the optimal language for models to write in and most importantly get to feedback from the compiler. in many ways, it was designed perfectly for it.\n12\n9\n75\n1.3K\nMinh Nhat Nguyen\n@menhguin\n·\n34m\n4\n54\nRob Bensinger  reposted\nvitrupo\n@vitrupo\n·\nMay 27\nSteven Bartlett says a top AI CEO tells the public "everything will be fine" -- but privately expects something "pretty horrific."\n\nA friend told him: "What [the CEO] tells me in private is not what he's saying publicly."\n127\n264\n1.2K\n409K\nCate Hall\n@catehall\n·\n18h\nThis image is so load-bearing for me psychologically -- I think about it all the time\n52\n181\n4.2K\n142K\nalice\n@__justplaying\n·\n\n16\n45\n918\n28K\nJakeup\n@yashkaf\n·\nMay 29\nmaking Harry Potter a "destined hero marked at birth" instead of a guy whose skills are *earned* made the plot worse, the characters unrelatable, and enabled lazy cop outs and ex-machinas\nQuote\nmeme guy \n@mask_guy\n·\nMay 27\ncan you trigger a fan base with one sentence\n57\n22\n676\n32K

Example Correct Output:
<Negative>Steven Bartlett says a top AI CEO tells the public</Negative>
<Negative>pretty horrific</Negative>
<Negative>This image is so load-bearing for me psychologically</Negative>
<Negative>the characters unrelatable, and enabled lazy cop outs and ex-machinas</Negative>
<Negative>can you trigger a fan base with one sentence</Negative>`;

const DEFAULT_USER_PROMPT_PREFIX = `Analyze the following text content and extract controversial, politically aggressive, non-technical, low-effort, non-insightful, or negative statements using <Negative> tags as instructed:\n\n----\n`;
const DEFAULT_USER_PROMPT_SUFFIX = `\n----\n\nRemember to only return the tagged statements, nothing else.`; // Suffix remains constant for now

Object.assign(self.ForcefieldLLM, { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT_PREFIX, DEFAULT_USER_PROMPT_SUFFIX });
