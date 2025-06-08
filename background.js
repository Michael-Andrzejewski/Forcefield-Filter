// Default AI System Prompt
const DEFAULT_SYSTEM_PROMPT = `Your task is to identify potentially controversial, politically charged, or negative statements within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger controversial statement.

Focus on extracting specific statements (phrases or sentences) that:
- Criticize political figures or parties
- Make controversial claims
- Contain strong negative opinions or insults
- Discuss polarizing social or political topics
- Use inflammatory or charged language

For each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.
Do NOT add explanations, apologies, or any text outside the <Negative> tags.
Do NOT tag entire paragraphs; the tool only works on single statements.
Be selective and only tag genuinely negative/controversial content, not neutral descriptions or news headlines.

Example Input Text:
'The new policy announced yesterday is terrible. Many people are upset. Read more on our blog. Meanwhile, the weather is nice.'

Example Correct Output:
<Negative>The new policy announced yesterday is terrible.</Negative>
<Negative>Many people are upset.</Negative>`;

// Default AI User Prompt Prefix
const DEFAULT_USER_PROMPT_PREFIX = "Analyze the following text content and extract potentially controversial, politically charged, or negative statements using <Negative> tags as instructed:\n\n----\n";
const DEFAULT_USER_PROMPT_SUFFIX = "\n----\n\nRemember to only return the tagged statements, nothing else.";

// AI Model Configuration
const AVAILABLE_AI_MODELS = {
    'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet (New)',
    'claude-3-opus-20240229': 'Claude 3 Opus',
    'claude-3-sonnet-20240229': 'Claude 3 Sonnet (Older)',
    'claude-3-haiku-20240307': 'Claude 3 Haiku',
    'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet (Future)'
};
const DEFAULT_AI_MODEL = 'claude-3-5-sonnet-20240620';

let currentAiCallAbortController = null;
let activeScanTabId = null; // Keep track of which tab is being scanned
let aiCallCounter = 0; // Counter for unique AI call IDs

// Load activeScanTabId on startup
chrome.storage.local.get(['activeScanTabId'], (result) => {
    if (result.activeScanTabId) {
        activeScanTabId = result.activeScanTabId;
        console.log(`[Forcefield Background] Loaded activeScanTabId from storage: ${activeScanTabId}`);
    } else {
        console.log(`[Forcefield Background] No activeScanTabId found in storage on startup.`);
    }
});

// Utility function to log messages to a specific tab's console
async function logToPageConsole(tabId, ...args) {
  if (!tabId) {
    console.log('[Forcefield Background] logToPageConsole: Missing tabId. Args:', ...args);
    return;
  }
  try {
    const preparedArgs = args.map(arg =>
        (typeof arg === 'object' && arg !== null) ? JSON.stringify(arg, null, 2) : arg
    );
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (...logs) => { console.log(...logs); },
      args: preparedArgs,
    });
  } catch (error) {
    // If tab is not accessible, log it calmly. Otherwise, it's a more concerning error.
    if (error.message.includes("No tab with id") || 
        error.message.includes("Cannot access") || // Covers chrome://, file://, etc.
        error.message.includes("The tab was closed")) {
      console.log(`[Forcefield Background] logToPageConsole: Tab ${tabId} not accessible. Args:`, preparedArgs.slice(0, 2)); // Log first few args for context
    } else {
      console.warn('[Forcefield Background] Failed to log message to page console (tabId: ', tabId, ') with unexpected error:', error, 'Args:', preparedArgs.slice(0, 2));
    }
  }
}

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

// Function to determine the default block level based on the site URL
function getDefaultLevelForSite(url) {
    const defaultLevel = 1;
    if (!url) return defaultLevel; // Guard against undefined URL

    const siteDefaults = {
        'twitter.com': 8,
        'x.com': 8,
        'quora.com': 10
    };
    try {
        const hostname = new URL(url).hostname;
        const effectiveHostname = hostname.startsWith('www.') ? hostname.substring(4) : hostname;
        if (siteDefaults.hasOwnProperty(effectiveHostname)) {
            console.log(`[Forcefield Background] Using site-specific default level ${siteDefaults[effectiveHostname]} for ${effectiveHostname}`);
            return siteDefaults[effectiveHostname];
        }
    } catch (e) {
        console.error("[Forcefield Background] Could not parse URL for default level:", url, e);
    }
    return defaultLevel;
}

// We need the actual function that does the blocking
function actualContentBlockingFunction(blockListToUse, debugMode, whiteboxMode) {
    function normalizeApostrophes(str) {
        if (!str) return str;
        return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'");
    }

    const hiddenMarker = 'hiddenByForcefield';
    const debugHighlightClass = 'forcefield-debug-highlight';
    const debugHighlightStyle = 'background-color: rgba(255, 0, 0, 0.3) !important; border: 1px solid red !important; display: revert !important; visibility: revert !important;';
    const whiteboxStyle = 'background-color: white !important; border: 1px dashed #ccc !important; visibility: visible !important; overflow: hidden !important;';

    // First, reset all previously affected elements
    const previouslyAffected = document.querySelectorAll(`[data-${hiddenMarker}]`);
    previouslyAffected.forEach(el => {
        // Restore original styles if they were saved
        if (el.dataset.originalDisplay) el.style.display = el.dataset.originalDisplay;
        else el.style.display = '';

        if (el.dataset.originalVisibility) el.style.visibility = el.dataset.originalVisibility;
        else el.style.visibility = '';
        
        if (el.dataset.originalBorder) el.style.border = el.dataset.originalBorder;
        else el.style.border = '';

        if (el.dataset.originalBackgroundColor) el.style.backgroundColor = el.dataset.originalBackgroundColor;
        else el.style.backgroundColor = '';

        if (el.dataset.originalWidth) el.style.width = el.dataset.originalWidth;
        else el.style.width = '';

        if (el.dataset.originalHeight) el.style.height = el.dataset.originalHeight;
        else el.style.height = '';
        
        el.innerHTML = el.dataset.originalInnerHTML || ''; // Restore content if whiteboxed

        el.classList.remove(debugHighlightClass);
        delete el.dataset[hiddenMarker];
        delete el.dataset.originalDisplay;
        delete el.dataset.originalVisibility;
        delete el.dataset.originalBorder;
        delete el.dataset.originalBackgroundColor;
        delete el.dataset.originalWidth;
        delete el.dataset.originalHeight;
        delete el.dataset.originalInnerHTML;

       if (el.style.visibility === 'hidden' || el.style.display === 'none') {
            el.style.visibility = 'revert';
            el.style.display = 'revert';
       }
    });

    console.log(`[Forcefield Content Blocker (from SW)] Starting scan for ${blockListToUse.length} words/phrases. Debug: ${debugMode}`);
    const allElements = document.body.getElementsByTagName('*');
    let elementsAffected = 0;

    for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];
        // Skip logic considering whitebox mode
        if (element.style.display === 'none' && !element.dataset[hiddenMarker] && !debugMode) {
            continue;
        }

        let foundMatch = null;
        let matchedBlockItem = null;

        for (const childNode of element.childNodes) {
            if (childNode.nodeType === 3 && childNode.nodeValue && childNode.nodeValue.trim()) {
                const normalizedNodeText = normalizeApostrophes(childNode.nodeValue).toLowerCase();
                for (const item of blockListToUse) {
                    const normalizedBlockText = normalizeApostrophes(item.text).toLowerCase();
                    if (normalizedNodeText.includes(normalizedBlockText)) {
                        foundMatch = element;
                        matchedBlockItem = item;
                        break;
                    }
                }
            }
            if (foundMatch) break;
        }

        if (foundMatch && matchedBlockItem) {
            const levelsToAscend = matchedBlockItem.level;
            let elementToHide = foundMatch;
            let actualLevelsAscended = 0;
            for (let j = 0; j < levelsToAscend && elementToHide.parentElement; j++) {
                if (elementToHide.parentElement === document.body || elementToHide.parentElement === document.documentElement) {
                    if (levelsToAscend > 0) {
                        console.warn(`[Forcefield Content Blocker (from SW)] Ascent for "${matchedBlockItem.text}" (level ${levelsToAscend}) stopped early at level ${j}. Hiding:`, elementToHide);
                    }
                    break;
                }
                elementToHide = elementToHide.parentElement;
                actualLevelsAscended++;
            }

            if (elementToHide && elementToHide !== document.body && elementToHide !== document.documentElement) {
                if (debugMode) {
                    if (!elementToHide.classList.contains(debugHighlightClass)) {
                        elementToHide.style.cssText += debugHighlightStyle;
                        elementToHide.classList.add(debugHighlightClass);
                        elementToHide.dataset[hiddenMarker] = 'debug';
                        elementsAffected++;
                    }
                } else if (whiteboxMode) {
                    if (elementToHide.dataset[hiddenMarker] !== 'whiteboxed') {
                        const computedStyle = window.getComputedStyle(elementToHide);
                        elementToHide.dataset.originalDisplay = elementToHide.style.display || '';
                        elementToHide.dataset.originalVisibility = elementToHide.style.visibility || '';
                        elementToHide.dataset.originalBorder = elementToHide.style.border || '';
                        elementToHide.dataset.originalBackgroundColor = elementToHide.style.backgroundColor || '';
                        elementToHide.dataset.originalWidth = computedStyle.width;
                        elementToHide.dataset.originalHeight = computedStyle.height;
                        elementToHide.dataset.originalInnerHTML = elementToHide.innerHTML;

                        elementToHide.innerHTML = '';
                        elementToHide.style.cssText += whiteboxStyle;
                        elementToHide.style.width = elementToHide.dataset.originalWidth;
                        elementToHide.style.height = elementToHide.dataset.originalHeight;
                        if (computedStyle.display === 'inline') {
                            elementToHide.style.display = 'inline-block';
                        } else if (computedStyle.display === 'none' || computedStyle.display === ''){
                            elementToHide.style.display = 'block';
                        } else {
                            elementToHide.style.display = computedStyle.display;
                        }
                        elementToHide.dataset[hiddenMarker] = 'whiteboxed';
                        elementsAffected++;
                    }
                } else {
                    if (elementToHide.style.display !== 'none') {
                        elementToHide.style.display = 'none';
                        elementToHide.dataset[hiddenMarker] = 'true';
                        elementsAffected++;
                    }
                }
            } else if (elementToHide && elementToHide.dataset[hiddenMarker]) {
                // Already hidden or highlighted by us
            } else if (elementToHide === document.body || elementToHide === document.documentElement) {
                 console.warn(`[Forcefield Content Blocker (from SW)] Avoided affecting BODY/HTML for "${matchedBlockItem.text}".`);
            }
        }
    }
    if (elementsAffected > 0) {
        console.log(`[Forcefield Content Blocker (from SW)] Scan finished. ${debugMode ? 'Highlighted' : 'Hid'} ${elementsAffected} elements.`);
    } else {
        console.log(`[Forcefield Content Blocker (from SW)] Scan finished. No new elements ${debugMode ? 'highlighted' : 'hidden'}.`);
    }
}

// Centralized function to trigger the blocking on the page
function triggerPageBlock(tabId, blockList, debugMode) {
    if (!tabId) {
        console.error("[Forcefield Background] triggerPageBlock: Missing tabId.");
        return;
    }
    chrome.storage.local.get(['whiteboxMode'], (result) => { // Get whitebox mode state
        const whiteboxMode = result.whiteboxMode || false;
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: actualContentBlockingFunction,
            args: [blockList, debugMode, whiteboxMode] // Pass whiteboxMode
        }).catch(err => {
            if (err.message.includes("No tab with id") || 
                err.message.includes("Cannot access") ||
                err.message.includes("The tab was closed")) {
                console.log(`[Forcefield Background] triggerPageBlock: Tab ${tabId} not accessible for re-blocking.`);
            } else {
                console.warn(`[Forcefield Background] Error in executeScript for triggerPageBlock on tab ${tabId} (unexpected):`, err);
            }
        });
    });
}

// Modified addSuggestedWords for background context
async function addSuggestedWords(suggestions, defaultLevelOverride = null, source = 'ai_continuous', tabIdForContext) {
    let defaultLevelToUse = 1;
    let tabUrl = null;

    if (tabIdForContext) {
        try {
            const tab = await chrome.tabs.get(tabIdForContext);
            tabUrl = tab.url;
        } catch (e) {
            if (e.message.includes("No tab with id")) {
                console.info(`[Forcefield Background] addSuggestedWords: Tab ${tabIdForContext} not found for URL check. Using default level.`);
            } else {
                console.warn(`[Forcefield Background] Error getting tab URL for tabId ${tabIdForContext} (unexpected):`, e);
            }
        }
    }

    if (defaultLevelOverride !== null) {
        defaultLevelToUse = defaultLevelOverride;
    } else if (tabUrl) {
        defaultLevelToUse = getDefaultLevelForSite(tabUrl);
    }

    const { blockList: currentBlockList } = await chrome.storage.local.get(['blockList']);
    let blockList = currentBlockList || [];
    let addedCount = 0;
    const newSuggestionsForLogging = [];

    suggestions.forEach(word => {
        const trimmedWord = word.trim();
        if (trimmedWord && !blockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
            blockList.push({ text: trimmedWord, level: defaultLevelToUse, source: source });
            addedCount++;
            newSuggestionsForLogging.push(`"${trimmedWord}" (level ${defaultLevelToUse})`);
            console.log(`[Forcefield Background - ${source}] Added suggestion: "${trimmedWord}" (level ${defaultLevelToUse})`);
        } else if (trimmedWord) {
            console.log(`[Forcefield Background - ${source}] Suggestion "${trimmedWord}" already in list or is empty.`);
        }
    });

    if (addedCount > 0) {
        await chrome.storage.local.set({ blockList });
        console.log(`[Forcefield Background - ${source}] Added ${addedCount} new suggestions to the blocklist.`);
        chrome.runtime.sendMessage({ command: "blockListUpdated", newSuggestions: newSuggestionsForLogging, source: source }).catch(e => {}); 

        if (tabIdForContext) {
            logToPageConsole(tabIdForContext, `[Forcefield AI - ${source}] Added ${addedCount} new blocks: ${newSuggestionsForLogging.join(', ')}`);
        }
    } else {
         console.log(`[Forcefield Background - ${source}] No new suggestions were added to the list.`);
         if (tabIdForContext) {
            logToPageConsole(tabIdForContext, `[Forcefield AI - ${source}] No new blocks found to add.`);
        }
    }
    return blockList; 
}

async function refinePromptsWithAI(selectedText, tabId) {
    const logPrefix = `[Forcefield Prompt Refine - Tab ${tabId}]`;
    console.log(`${logPrefix} Starting prompt refinement...`);
    logToPageConsole(tabId, '[Forcefield AI] Starting prompt refinement based on selected text.');

    try {
        const [storageSystemPrompt, storageUserPrompt, storedApiKeys] = await Promise.all([
            chrome.storage.sync.get(['customSystemPrompt']),
            chrome.storage.sync.get(['customUserPromptPrefix']),
            chrome.storage.sync.get(['anthropicApiKey'])
        ]);

        const anthropicApiKey = storedApiKeys.anthropicApiKey;
        if (!anthropicApiKey) {
            console.error(`${logPrefix} Anthropic API Key not found.`);
            logToPageConsole(tabId, `[Forcefield AI] Error: Anthropic API Key not set. Cannot refine prompts.`);
            return;
        }

        const currentSystemPrompt = storageSystemPrompt.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
        const currentUserPromptPrefix = storageUserPrompt.customUserPromptPrefix !== undefined ? storageUserPrompt.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX;

        const metaSystemPrompt = `You are an AI assistant that refines prompts for another AI. The other AI's task is to identify and tag negative content on web pages. You will be given the other AI's current system prompt, its user prompt prefix, and an example of text that it should have blocked but didn't. Your task is to revise the system prompt and user prefix to better block similar content in the future. Output the revised prompts inside <system_prompt> and </system_prompt> tags, and <user_prefix> and </user_prefix> tags. Do not include any other text in your response.`;

        const metaUserPrompt = `Current System Prompt:\n---\n${currentSystemPrompt}\n---\n\nCurrent User Prefix:\n---\n${currentUserPromptPrefix}\n---\n\nExample text to block:\n---\n${selectedText}\n---`;

        const requestBody = {
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 4096,
            temperature: 0.5,
            system: metaSystemPrompt,
            messages: [{ role: "user", content: metaUserPrompt }]
        };
        
        console.log(`${logPrefix} Sending prompt refinement request to AI.`);
        logToPageConsole(tabId, '[Forcefield AI] Sending request to refine prompts...');

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorBodyText = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorBodyText}`);
        }

        const result = await response.json();
        console.log(`${logPrefix} AI Refinement Response:`, result);
        logToPageConsole(tabId, `[Forcefield AI] Received refinement response:`, result);

        let aiResponseContent = '';
        if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
            aiResponseContent = result.content[0].text;
        }

        const systemPromptRegex = /<system_prompt>([\s\S]*?)<\/system_prompt>/;
        const userPrefixRegex = /<user_prefix>([\s\S]*?)<\/user_prefix>/;

        const newSystemPromptMatch = aiResponseContent.match(systemPromptRegex);
        const newUserPrefixMatch = aiResponseContent.match(userPrefixRegex);

        let updated = false;
        const updates = {};
        if (newSystemPromptMatch && newSystemPromptMatch[1]) {
            const newSystemPrompt = newSystemPromptMatch[1].trim();
            updates.customSystemPrompt = newSystemPrompt;
            console.log(`${logPrefix} Found new system prompt.`);
            logToPageConsole(tabId, `[Forcefield AI] Found new system prompt.`);
            updated = true;
        } else {
             console.warn(`${logPrefix} No <system_prompt> tag found in AI response.`);
             logToPageConsole(tabId, `[Forcefield AI] Warning: No <system_prompt> tag found in AI response.`);
        }

        if (newUserPrefixMatch && newUserPrefixMatch[1]) {
            const newUserPrefix = newUserPrefixMatch[1].trim();
            updates.customUserPromptPrefix = newUserPrefix;
            console.log(`${logPrefix} Found new user prefix.`);
            logToPageConsole(tabId, `[Forcefield AI] Found new user prefix.`);
            updated = true;
        } else {
            console.warn(`${logPrefix} No <user_prefix> tag found in AI response.`);
            logToPageConsole(tabId, `[Forcefield AI] Warning: No <user_prefix> tag found in AI response.`);
        }

        if (updated) {
            await chrome.storage.sync.set(updates);
            console.log(`${logPrefix} Successfully updated prompts in storage.`);
            logToPageConsole(tabId, `[Forcefield AI] Prompts have been updated! Please review them in the extension popup.`);
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon48.png',
                title: 'Forcefield Prompts Updated',
                message: 'The AI has refined your blocking prompts. Check the popup to see the changes.'
            });
        }

    } catch (error) {
        console.error(`${logPrefix} Error during prompt refinement:`, error);
        logToPageConsole(tabId, `[Forcefield AI] Error during prompt refinement:`, error.message);
    }
}

async function processNewContentWithAIBackground(text, tabId, originalSendResponse) {
    aiCallCounter++;
    const callId = aiCallCounter;
    const logPrefix = `[Forcefield BG Call #${callId} - Tab ${tabId || 'unknown'}]`;
    let responseSent = false;

    function safeSendResponse(responseArg) {
        if (!responseSent) {
            console.log(`${logPrefix} Sending response:`, responseArg);
            originalSendResponse(responseArg);
            responseSent = true;
        } else {
            console.warn(`${logPrefix} Response already sent for this call. Suppressed extra:`, responseArg);
        }
    }

    if (!tabId) {
        console.warn(`${logPrefix} processNewContentWithAIBackground called without tabId.`);
        safeSendResponse({status: "Error: Missing tabId for AI processing", error: "Missing tabId"});
        return;
    }

    console.log(`${logPrefix} Processing new text chunk...`);
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "AI processing new content..."}).catch(e => {});

    if (currentAiCallAbortController) {
        console.warn(`${logPrefix} Aborting previous AI call due to new content.`);
        currentAiCallAbortController.abort("New content arrived");
    }
    currentAiCallAbortController = new AbortController();
    const signal = currentAiCallAbortController.signal;

    const MAX_RETRIES = 1;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
        if (attempt > 0) {
            console.log(`${logPrefix} Retrying AI call (attempt ${attempt} of ${MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            if (signal.aborted) {
                console.log(`${logPrefix} Retry attempt aborted.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "AI processing aborted."}).catch(e => {});
                safeSendResponse({status: "AI processing aborted before retry", reason: signal.reason});
                return;
            }
        }

        try {
            const [storageSystemPrompt, storageUserPrompt, storageModel, storageIsScanning, storageDebugMode, storedApiKeys] = await Promise.all([
                chrome.storage.sync.get(['customSystemPrompt']),
                chrome.storage.sync.get(['customUserPromptPrefix']),
                chrome.storage.sync.get(['selectedAiModel']),
                chrome.storage.local.get(['isScanning']),
                chrome.storage.local.get(['debugMode']),
                chrome.storage.sync.get(['anthropicApiKey']) // Fetch Anthropic API Key
            ]);

            if (!storageIsScanning.isScanning) {
                console.log(`${logPrefix} Global scanning is off. Aborting AI processing.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "Processing aborted (scan stopped)."}).catch(e => {});
                safeSendResponse({status: "AI processing aborted: Global scan off"});
                return;
            }
            if (activeScanTabId !== tabId) {
                 console.log(`${logPrefix} Tab is not the active scanning tab (${activeScanTabId}). Ignoring content.`);
                 safeSendResponse({status: "AI processing ignored: Not active scan tab"});
                 return;
            }

            const currentSystemPrompt = storageSystemPrompt.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
            const currentUserPromptPrefix = storageUserPrompt.customUserPromptPrefix !== undefined ? storageUserPrompt.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX;
            const selectedModel = storageModel.selectedAiModel || DEFAULT_AI_MODEL;
            const currentAiModel = AVAILABLE_AI_MODELS[selectedModel] ? selectedModel : DEFAULT_AI_MODEL;
            const anthropicApiKey = storedApiKeys.anthropicApiKey; // Get the key

            if (!anthropicApiKey) {
                console.error(`${logPrefix} Anthropic API Key not found in storage.`);
                logToPageConsole(tabId, `[Forcefield AI #${callId}] Error: Anthropic API Key not set. Continuous scanning AI features disabled.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "Error: Anthropic API Key missing."}).catch(e => {});
                safeSendResponse({status: "AI processing error: Anthropic API Key missing"});
                return; // Stop if key is missing
            }

            const userPrompt = `${currentUserPromptPrefix}${text}${DEFAULT_USER_PROMPT_SUFFIX}`;
            const requestBody = {
                model: currentAiModel,
                max_tokens: 4096,
                temperature: 0.5,
                system: currentSystemPrompt,
                messages: [{ role: "user", content: userPrompt }]
            };

            console.log(`${logPrefix} AI Call Initiated (attempt ${attempt}). Model: ${currentAiModel}.`);
            logToPageConsole(tabId, `[Forcefield AI #${callId}] Sending prompt (attempt ${attempt}). Body:`, JSON.stringify(requestBody, null, 2));

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': anthropicApiKey, // Use the stored key
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify(requestBody),
                signal: signal
            });

            if (signal.aborted) {
                console.log(`${logPrefix} API call aborted during fetch.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "AI processing aborted."}).catch(e => {});
                safeSendResponse({status: "AI processing aborted during fetch", reason: signal.reason });
                return;
            }

            if (!response.ok) {
                const errorBodyText = await response.text();
                const error = new Error(`API request failed: ${response.status} ${response.statusText} - ${errorBodyText}`);
                error.status = response.status;
                throw error;
            }

            const result = await response.json();
            console.log(`${logPrefix} AI Call Success (attempt ${attempt}).`);
            logToPageConsole(tabId, `[Forcefield AI #${callId}] Received response:`, result);

            let aiResponseContent = '';
            if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
                aiResponseContent = result.content[0].text;
            }

            const suggestions = extractNegativeTags(aiResponseContent);
            console.log(`${logPrefix} Extracted suggestions:`, suggestions);
            logToPageConsole(tabId, `[Forcefield AI #${callId}] Extracted suggestions:`, suggestions);

            if (suggestions.length > 0) {
                const currentDebugMode = storageDebugMode.debugMode || false;
                const updatedBlockList = await addSuggestedWords(suggestions, null, `ai_continuous_bg_${callId}`, tabId);
                if (updatedBlockList && updatedBlockList.length > 0) {
                    const { whiteboxMode } = await chrome.storage.local.get(['whiteboxMode']);
                    triggerPageBlock(tabId, updatedBlockList, currentDebugMode, whiteboxMode || false);
                }
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Processed: ${suggestions.length} new blocks. Re-blocking.`}).catch(e => {});
                safeSendResponse({status: "AI processing complete", suggestionsAdded: suggestions.length});
            } else {
                logToPageConsole(tabId, `[Forcefield AI #${callId}] No new suggestions found.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'AI found no new items to block.'}).catch(e => {});
                safeSendResponse({status: "AI processing complete", suggestionsAdded: 0});
            }
            break;

        } catch (error) {
            if (signal.aborted && error.name === 'AbortError') {
                console.log(`${logPrefix} Fetch aborted as expected (attempt ${attempt}). Reason: ${signal.reason}`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'AI processing aborted.'}).catch(e => {});
                safeSendResponse({status: "AI processing aborted by signal", reason: signal.reason});
                break;
            }

            console.error(`${logPrefix} AI Call Error (attempt ${attempt}):`, error.message, error);
            logToPageConsole(tabId, `[Forcefield AI #${callId}] Error (attempt ${attempt}):`, error.message);

            const isRetryable = !error.status || (error.status >= 500 && error.status <= 599);

            if (isRetryable && attempt < MAX_RETRIES) {
                attempt++;
                console.log(`${logPrefix} Will attempt retry #${attempt}.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `AI Error. Retrying (${attempt}/${MAX_RETRIES})...`}).catch(e => {});
            } else if (!isRetryable) {
                console.error(`${logPrefix} Non-retryable error (${error.status || 'network error'}). Aborting further attempts.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Error: ${error.message.substring(0,50)}... (Not retrying)`}).catch(e => {});
                safeSendResponse({status: "AI processing error: Non-retryable", error: error.message});
                break;
            } else {
                console.error(`${logPrefix} Max retries reached. Aborting further attempts.`);
                chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Error: ${error.message.substring(0,50)}... (Max retries)`}).catch(e => {});
                safeSendResponse({status: "AI processing error: Max retries reached", error: error.message});
                break;
            }
        }
    }

    if (!responseSent && !signal.aborted) {
        console.warn(`${logPrefix} AI processing loop completed without explicit response. Sending generic failure.`);
        safeSendResponse({status: "AI processing failed: Unknown reason after loop completion"});
    }
    else if (!responseSent && signal.aborted) {
        console.warn(`${logPrefix} AI processing was aborted, but no explicit abort response was sent. Sending generic abort response.`);
        safeSendResponse({status: "AI processing aborted: Generic", reason: signal.reason});
    }

    currentAiCallAbortController = null;
    chrome.storage.local.get(['isScanning'], (res) => {
        if (res.isScanning && activeScanTabId === tabId) {
             chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'Scanning active...'}).catch(e => {});
        }
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const onMessageLogPrefix = `[Forcefield BG OnMessage - Cmd: ${request.command}]`;

    if (request.command === "newContentDetected") {
        console.log(`${onMessageLogPrefix} Received from tab:`, sender.tab ? sender.tab.id : 'unknown tab');
        if (sender.tab && sender.tab.id) {
            chrome.storage.local.get(['isScanning'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error(`${onMessageLogPrefix} Error getting local storage for 'isScanning':`, chrome.runtime.lastError.message);
                    sendResponse({status: "Error: Failed to get storage state for scanning check", error: chrome.runtime.lastError.message});
                    return;
                }

                if (result.isScanning && sender.tab.id === activeScanTabId) {
                    processNewContentWithAIBackground(request.text, sender.tab.id, sendResponse);
                } else {
                    let reason = "Content ignored: Conditions not met.";
                    if (!result.isScanning) reason = "Global scanning is off";
                    else if (sender.tab.id !== activeScanTabId) reason = `Content from inactive tab ${sender.tab.id} (active is ${activeScanTabId})`;
                    
                    console.log(`${onMessageLogPrefix} Content from tab ${sender.tab.id} will be ignored. Reason: ${reason}.`);
                    sendResponse({status: "Content ignored by background", reason: reason});
                }
            });
            return true; 
        } else {
            console.warn(`${onMessageLogPrefix} newContentDetected received without proper sender tab ID.`);
            sendResponse({status: "Error: Missing sender tab ID", error: "Sender tab ID not available"});
            return false; 
        }
    } else if (request.command === "startContinuousScanBG") {
        activeScanTabId = request.tabId;
        chrome.storage.local.set({ activeScanTabId: request.tabId }, () => {
            console.log(`[Forcefield Background] Service worker instructed to start/monitor continuous scan for tab ${request.tabId}. Stored.`);
        });
        sendResponse({status: "Background aware of scan start"});
    } else if (request.command === "stopContinuousScanBG") {
        console.log(`[Forcefield Background] Service worker instructed to stop scan for tab ${request.tabId}`);
        if (activeScanTabId === request.tabId) {
            activeScanTabId = null;
            chrome.storage.local.remove('activeScanTabId', () => { // Or set to null: chrome.storage.local.set({ activeScanTabId: null })
                console.log(`[Forcefield Background] Cleared activeScanTabId from storage.`);
            });
            if (currentAiCallAbortController) {
                currentAiCallAbortController.abort("Scan stopped by instruction");
                currentAiCallAbortController = null;
                console.log('[Forcefield Background] Aborted ongoing AI call due to scan stop instruction.');
            }
        }
        sendResponse({status: "Background aware of scan stop"});
    } else if (request.command === "getActiveScanTabId") {
        sendResponse({activeScanTabId: activeScanTabId});
    } else if (request.command === "getGlobalScanningState") {
        chrome.storage.local.get(['isScanning'], (result) => {
            sendResponse({isScanningGlobally: result.isScanning || false});
        });
        return true;
    } else if (request.command === "getCurrentTabId") {
        if (sender.tab && sender.tab.id) {
            sendResponse({tabId: sender.tab.id});
        } else {
            sendResponse({tabId: null});
        }
    } else if (request.command === "elementSelected") {
        console.log(`[Forcefield Background] Element selected with text:`, request.text);
        refinePromptsWithAI(request.text, sender.tab.id);
        sendResponse({status: "AI prompt refinement started"});
        return true; // async response
    }

    return true;
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const newTabId = activeInfo.tabId;
    console.log(`[Forcefield Background] Tab activated: ${newTabId}`);

    const { isScanning } = await chrome.storage.local.get(['isScanning']);
    if (!isScanning) {
        return;
    }

    const previousActiveScanTabId = activeScanTabId;

    if (previousActiveScanTabId && previousActiveScanTabId !== newTabId) {
        console.log(`[Forcefield Background] Attempting to stop observer on old tab ${previousActiveScanTabId}`);
        chrome.tabs.sendMessage(previousActiveScanTabId, { command: "stopObserving" })
            .catch(err => console.warn(`[Forcefield Background] Error sending stopObserving to old tab ${previousActiveScanTabId}: ${err.message}. Tab might be closed.`));
    }

    activeScanTabId = newTabId;
    chrome.storage.local.set({ activeScanTabId: newTabId }, () => {
        console.log(`[Forcefield Background] Active scan tab updated to: ${activeScanTabId}. Stored.`);
    });

    try {
        const tab = await chrome.tabs.get(newTabId);
        if (tab.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
            console.log(`[Forcefield Background] Tab ${newTabId} is already complete, ensuring script and starting observer.`);
            await chrome.scripting.executeScript({
                target: { tabId: newTabId },
                files: ['continuousScan.js']
            });
            console.log(`[Forcefield Background] Ensured content script on new tab ${newTabId}, sending startObserving.`);
            chrome.tabs.sendMessage(newTabId, { command: "startObserving" })
                .catch(err => console.warn(`[Forcefield Background] Error sending startObserving to new tab ${newTabId} (onActivated): ${err.message}`));
        } else {
            console.log(`[Forcefield Background] Tab ${newTabId} not yet complete or invalid URL on activation. Waiting for onUpdated.`);
        }
    } catch (err) {
        console.warn(`[Forcefield Background] Failed to process new tab ${newTabId} on activation: ${err.message}. This can happen on special pages (e.g. chrome://).`);
    }
    
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Scanning tab ${newTabId}...`}).catch(e => {});
});

// Listen for tab updates (e.g., new URL loaded, page finished loading)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        console.log(`[Forcefield Background] Tab updated and complete: ${tabId}, URL: ${tab.url}`);

        const { isScanning } = await chrome.storage.local.get(['isScanning']);
        if (!isScanning) {
            return;
        }

        if (tabId === activeScanTabId) {
            console.log(`[Forcefield Background] Tab ${tabId} is the active scan tab. Ensuring script and starting observer.`);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['continuousScan.js']
                });
                console.log(`[Forcefield Background] Ensured content script on updated tab ${tabId}, sending startObserving.`);
                chrome.tabs.sendMessage(tabId, { command: "startObserving" })
                    .catch(err => console.warn(`[Forcefield Background] Error sending startObserving to updated tab ${tabId} (onUpdated): ${err.message}`));
            } catch (err) {
                console.warn(`[Forcefield Background] Failed to inject/start script on updated tab ${tabId}: ${err.message}. This can happen on special pages.`);
            }
        } else {
        }
    }
});

console.log("[Forcefield Background] Service worker started."); 