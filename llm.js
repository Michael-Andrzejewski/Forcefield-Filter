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
