// Provider abstraction (AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL, providerForModel, callLLM)
importScripts('llm.js');


// AI Model Configuration now lives in llm.js (AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL).

let currentAiCallAbortController = null;
let activeScanTabId = null; // Keep track of which tab is being scanned
let aiCallCounter = 0; // Counter for unique AI call IDs
let lastKnownTabUrl = {}; // Store last known URL for each tab

chrome.runtime.onInstalled.addListener(() => {
    console.log('[Forcefield BG] Extension installed.');
    // Set initial values on installation
    chrome.storage.local.get(['isScanning', 'activeScanTabId', 'developerMode'], (result) => {
        if (typeof result.isScanning === 'undefined') {
            chrome.storage.local.set({ isScanning: false });
        }
        if (typeof result.activeScanTabId === 'undefined') {
            chrome.storage.local.set({ activeScanTabId: null });
        }
        if (typeof result.developerMode === 'undefined') {
            chrome.storage.local.set({ developerMode: false });
        }
    });
    // Set default allowed sites on first install
    chrome.storage.sync.get('allowedSites', (result) => {
        if (!result.allowedSites) {
            chrome.storage.sync.set({ allowedSites: ['twitter.com', 'x.com', 'quora.com'] });
        }
    });
});

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

// Function to handle the AI prompt refinement process
async function refineSystemPromptWithAI(incorrectlyBlockedText, tabId) {
    console.log('[Forcefield BG] Starting system prompt refinement for text:', incorrectlyBlockedText);

    // 1. Get current settings from storage
    const storedData = await new Promise((resolve) => {
        chrome.storage.sync.get(['customSystemPrompt', 'selectedAiModel', 'anthropicApiKey', 'geminiApiKey'], resolve);
    });

    const systemPrompt = storedData.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
    const model = storedData.selectedAiModel || DEFAULT_AI_MODEL;
    const apiKey = storedData.anthropicApiKey;
    const geminiApiKey = storedData.geminiApiKey;
    const provider = providerForModel(model);
    const keyForProvider = provider === 'google' ? geminiApiKey : apiKey;

    if (!keyForProvider) {
        const label = provider === 'google' ? 'Gemini' : 'Anthropic';
        console.error(`[Forcefield BG] Refinement failed: ${label} API Key is not set.`);
        // Notify the user on the page that the key is missing
        if (tabId) {
            logToPageConsole(tabId, `[Forcefield] ERROR: Cannot refine prompt. ${label} API key is missing. Please set it in the extension settings.`);
        }
        return;
    }

    // 2. Construct the specialized prompt for refinement
    const refinementPrompt = `The user has indicated that the following text was incorrectly blocked by the AI.
Original System Prompt:
---
${systemPrompt}
---
Incorrectly Blocked Text:
---
"${incorrectlyBlockedText}"
---
Your task is to analyze the original system prompt and the incorrectly blocked text. Modify the system prompt to be more precise or nuanced, so it will avoid blocking similar, non-negative text in the future, while still effectively blocking genuinely negative content.

Do NOT apologize or explain your reasoning.
ONLY return the complete, new, refined system prompt. Do not include any other text, titles, or formatting.
The output should be ready to be used directly as the new system prompt.`;


    console.log('[Forcefield BG] Sending refinement request to AI...');

    try {
        // 3. Make the API call via the provider abstraction
        const refinedText = await callLLM({
            model: model,
            userText: refinementPrompt,
            maxTokens: 4096,
            anthropicApiKey: apiKey,
            geminiApiKey: geminiApiKey
        });
        console.log('[Forcefield BG] Received AI response for refinement.');

        if (refinedText && refinedText.trim()) {
            const newSystemPrompt = refinedText.trim();

            // 4. Save the new prompt to storage
            await chrome.storage.sync.set({ customSystemPrompt: newSystemPrompt });
            console.log('[Forcefield BG] Successfully saved new refined system prompt.');

            // 5. Notify the user
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png', // You'll need to create this icon
                title: 'Forcefield AI Updated',
                message: 'The AI system prompt has been refined based on your feedback.'
            });

            // Optional: Log success message to the content page
            if (tabId) {
                logToPageConsole(tabId, '[Forcefield] AI system prompt has been successfully updated.');
            }

        } else {
            throw new Error('No valid text content returned from AI.');
        }

    } catch (error) {
        console.error('[Forcefield BG] Error during AI prompt refinement:', error);
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icons/icon128.png', // You'll need to create this icon
            title: 'Forcefield AI Error',
            message: `Failed to refine AI prompt: ${error.message}`
        });
    }
}


// We need the actual function that does the blocking
function actualContentBlockingFunction(blockListToUse, debugMode, whiteboxMode) {
    function normalizeApostrophes(str) {
        if (!str) return str;
        return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'");
    }

    // Strip whitespace + smart punctuation so fragmented / smart-quoted tweet text
    // still matches the AI's flagged phrase. Builds on normalizeApostrophes (above).
    function normalizeText(str) {
        if (!str) return '';
        return normalizeApostrophes(str)
            .replace(/[“”„«»]/g, '"') // curly/guillemet quotes -> "
            .replace(/[–—―−]/g, '-')       // en/em/figure dash, minus -> -
            .replace(/…/g, '...')                          // ellipsis -> ...
            .replace(/\s+/g, '')                                // drop all whitespace
            .toLowerCase();
    }

    const hiddenMarker = 'hiddenByForcefield';
    const debugHighlightClass = 'forcefield-debug-highlight';
    const debugHighlightStyle = 'background-color: rgba(255, 0, 0, 0.3) !important; border: 1px solid red !important; display: revert !important; visibility: revert !important;';
    const whiteboxStyle = 'background-color: white !important; border: 1px dashed #ccc !important; visibility: visible !important; overflow: hidden !important;';

    // First, reset all previously affected elements.
    // NOTE: dataset.hiddenByForcefield serializes to the attribute
    // data-hidden-by-forcefield — the selector must use the kebab-case form
    // (the old camelCase selector matched nothing, so resets never ran).
    const previouslyAffected = document.querySelectorAll('[data-hidden-by-forcefield]');
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
        
        // Restore content ONLY if we whiteboxed it (originalInnerHTML saved).
        // An unconditional assignment would wipe the content of elements that
        // were merely hidden or highlighted.
        if (el.dataset.originalInnerHTML !== undefined) {
            el.innerHTML = el.dataset.originalInnerHTML;
        }

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

    // Pre-normalize block phrases once (avoids re-normalizing per element).
    const normalizedBlockItems = [];
    for (const item of blockListToUse) {
        const nb = normalizeText(item.text);
        if (nb) normalizedBlockItems.push({ item: item, text: nb });
    }

    for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];
        // Skip logic considering whitebox mode
        if (element.style.display === 'none' && !element.dataset[hiddenMarker] && !debugMode) {
            continue;
        }

        // Never match inside script/style content.
        const tagName = element.tagName;
        if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') {
            continue;
        }

        let foundMatch = null;
        let matchedBlockItem = null;

        // Match against the element's FULL text so a phrase split across several
        // child <span>s (how Twitter renders tweet text) is still found. Pick the
        // DEEPEST element that contains it, so we anchor on the tightest node
        // rather than a page-level container. Skip very large elements for speed.
        const elementText = element.textContent;
        if (elementText && elementText.length <= 1000) {
            const normalizedElementText = normalizeText(elementText);
            for (const entry of normalizedBlockItems) {
                if (normalizedElementText.includes(entry.text)) {
                    let deeperChildMatches = false;
                    for (const child of element.children) {
                        if (normalizeText(child.textContent).includes(entry.text)) { deeperChildMatches = true; break; }
                    }
                    if (!deeperChildMatches) {
                        foundMatch = element;
                        matchedBlockItem = entry.item;
                        break;
                    }
                }
            }
        }

        if (foundMatch && matchedBlockItem) {
            const levelsToAscend = matchedBlockItem.level;
            let elementToHide = foundMatch;
            // Never climb past the enclosing post: X wraps each post in an
            // <article>, so clamping the ascent there means a generous level
            // hides/highlights exactly one post instead of a whole column.
            const postContainer = foundMatch.closest ? foundMatch.closest('article') : null;
            let actualLevelsAscended = 0;
            for (let j = 0; j < levelsToAscend && elementToHide.parentElement; j++) {
                if (postContainer && elementToHide === postContainer) {
                    break;
                }
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
function triggerPageBlock(tabId, blockList, debugMode, whiteboxMode) {
    if (!tabId) {
        console.error("[Forcefield Background] triggerPageBlock: Missing tabId.");
        return;
    }
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
        const [storageSystemPrompt, storageUserPrompt, storedApiKeys, storedModel] = await Promise.all([
            chrome.storage.sync.get(['customSystemPrompt']),
            chrome.storage.sync.get(['customUserPromptPrefix']),
            chrome.storage.sync.get(['anthropicApiKey', 'geminiApiKey']),
            chrome.storage.sync.get(['selectedAiModel'])
        ]);

        const anthropicApiKey = storedApiKeys.anthropicApiKey;
        const geminiApiKey = storedApiKeys.geminiApiKey;
        const model = storedModel.selectedAiModel || DEFAULT_AI_MODEL;
        const provider = providerForModel(model);
        const keyForProvider = provider === 'google' ? geminiApiKey : anthropicApiKey;
        if (!keyForProvider) {
            const label = provider === 'google' ? 'Gemini' : 'Anthropic';
            console.error(`${logPrefix} ${label} API Key not found.`);
            logToPageConsole(tabId, `[Forcefield AI] Error: ${label} API Key not set. Cannot refine prompts.`);
            return;
        }

        const currentSystemPrompt = storageSystemPrompt.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
        const currentUserPromptPrefix = storageUserPrompt.customUserPromptPrefix !== undefined ? storageUserPrompt.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX;

        const metaSystemPrompt = `You are an AI assistant that refines prompts for another AI. The other AI's task is to identify and tag negative content on web pages. You will be given the other AI's current system prompt, its user prompt prefix, and an example of text that it should have blocked but didn't. Your task is to revise the system prompt and user prefix to better block similar content in the future. Output the revised prompts inside <system_prompt> and </system_prompt> tags, and <user_prefix> and </user_prefix> tags. Do not include any other text in your response.`;

        const metaUserPrompt = `Current System Prompt:\n---\n${currentSystemPrompt}\n---\n\nCurrent User Prefix:\n---\n${currentUserPromptPrefix}\n---\n\nExample text to block:\n---\n${selectedText}\n---`;

        console.log(`${logPrefix} Sending prompt refinement request to AI.`);
        logToPageConsole(tabId, '[Forcefield AI] Sending request to refine prompts...');

        const aiResponseContent = await callLLM({
            model: model,
            system: metaSystemPrompt,
            userText: metaUserPrompt,
            maxTokens: 4096,
            anthropicApiKey: anthropicApiKey,
            geminiApiKey: geminiApiKey
        });
        console.log(`${logPrefix} AI Refinement Response received.`);
        logToPageConsole(tabId, `[Forcefield AI] Received refinement response.`);

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
                iconUrl: 'icons/icon48.png',
                title: 'Forcefield Prompts Updated',
                message: 'The AI has refined your blocking prompts. Check the popup to see the changes.'
            });
        }

    } catch (error) {
        console.error(`${logPrefix} Error during prompt refinement:`, error);
        logToPageConsole(tabId, `[Forcefield AI] Error during prompt refinement:`, error.message);
    }
}

// Listener for tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // We only care if the URL has changed and the tab is fully loaded
    if (changeInfo.status === 'complete' && tab.url && lastKnownTabUrl[tabId] !== tab.url) {
        lastKnownTabUrl[tabId] = tab.url;
        console.log(`[Forcefield BG] Tab ${tabId} updated to URL: ${tab.url}`);
        
        // When a tab updates, we need to check if scanning should start or stop
        chrome.storage.local.get(['isScanning', 'activeScanTabId'], async (result) => {
            if (result.isScanning) {
                const isAllowed = await isSiteAllowed(tab.url);

                if (result.activeScanTabId === tabId) {
                    // This is the currently active scanning tab
                    if (!isAllowed) {
                        // It navigated to a non-allowed site, so we should stop the observer.
                        console.log(`[Forcefield BG] Active scan tab ${tabId} navigated to a non-allowed site. Stopping observer.`);
                        stopObserverInTab(tabId);
                        // We don't change the global `isScanning` state here, just the observer in the tab.
                        // The user can navigate back to an allowed site to resume.
                    } else {
                        // It navigated to another allowed page on the same tab. Let's ensure the observer is running.
                        console.log(`[Forcefield BG] Active scan tab ${tabId} navigated to another allowed page. Ensuring observer is running.`);
                        startObserverInTab(tabId);
                    }
                } else {
                    // This is NOT the active scanning tab, but global scanning is on.
                    // If it navigates TO an allowed site, we don't do anything automatically.
                    // The user must switch to this tab to make it the active scanning tab.
                    // If it was a previously allowed site and is now not, we should ensure its observer is off.
                    if (!isAllowed) {
                        stopObserverInTab(tabId);
                    }
                }
            }
        });
    }
});

// Listener for when the active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tabId = activeInfo.tabId;
    console.log(`[Forcefield BG] Switched to tab ${tabId}.`);

    chrome.storage.local.get(['isScanning', 'activeScanTabId'], async (result) => {
        if (result.isScanning) {
            const previousActiveTabId = result.activeScanTabId;

            // Stop the observer in the previously active tab if it's different
            if (previousActiveTabId && previousActiveTabId !== tabId) {
                console.log(`[Forcefield BG] Deactivating observer in previous tab ${previousActiveTabId}.`);
                stopObserverInTab(previousActiveTabId);
            }

            // Check if the new tab is on an allowed site
            const tab = await chrome.tabs.get(tabId);
            if (await isSiteAllowed(tab.url)) {
                console.log(`[Forcefield BG] New active tab ${tabId} is on an allowed site. Starting observer.`);
                startObserverInTab(tabId);
                // And update the background's knowledge of the active tab
                chrome.storage.local.set({ activeScanTabId: tabId });
            } else {
                console.log(`[Forcefield BG] New active tab ${tabId} is not on an allowed site. Observer will not start.`);
                // If the new tab is not allowed, we don't have an "active" scanning tab.
                chrome.storage.local.set({ activeScanTabId: null });
            }
        }
    });
});

console.log("[Forcefield Background] Service worker started.");

// Main message handler for various requests from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
        if (request.command === "newContentDetected") {
            const tabId = sender.tab ? sender.tab.id : request.tabId; // Get tabId from sender or request
            if (tabId) {
                await processNewContentWithAIBackground(request.text, tabId, sendResponse);
            } else {
                console.warn("[Forcefield BG] newContentDetected received without a tabId.");
            }
            // processNewContentWithAIBackground will handle the response
        } else if (request.command === "startContinuousScanBG") {
            await handleStartScan(request.tabId);
            sendResponse({status: "Background handling start scan"});
        } else if (request.command === "stopContinuousScanBG") {
            await handleStopScan(request.tabId);
            sendResponse({status: "Background handling stop scan"});
        } else if (request.command === "getActiveScanTabId") {
            chrome.storage.local.get(['activeScanTabId'], (result) => {
                sendResponse({ activeScanTabId: result.activeScanTabId });
            });
        } else if (request.command === "getGlobalScanningState") {
            chrome.storage.local.get(['isScanning'], (result) => {
                sendResponse({ isScanningGlobally: result.isScanning });
            });
        } else if (request.command === "getCurrentTabId") {
            sendResponse({ tabId: sender.tab.id });
        } else if (request.command === "isSiteAllowed") {
            const isAllowed = await isSiteAllowed(sender.tab.url);
            sendResponse({ isAllowed: isAllowed });
        } else if (request.command === "refineTextWithAI") {
            await refinePromptsWithAI(request.text, sender.tab.id);
            sendResponse({status: "Refinement request received"});
        } else if (request.command === "runBlocker") {
            // Sent by content scripts (sender.tab set) AND by the popup
            // (no sender.tab — it passes request.tabId instead).
            const targetTabId = (sender.tab && sender.tab.id) || request.tabId;
            if (targetTabId) {
                const { blockList, debugMode, whiteboxMode } = await new Promise(resolve => {
                    chrome.storage.local.get(['blockList', 'debugMode', 'whiteboxMode'], resolve);
                });
                if (blockList && blockList.length > 0) {
                    triggerPageBlock(targetTabId, blockList, debugMode || false, whiteboxMode || false);
                }
            }
            sendResponse({status: "Blocker triggered"});
        } else if (request.command === "refineSystemPrompt") {
            const tabId = sender.tab ? sender.tab.id : null;
            refineSystemPromptWithAI(request.text, tabId)
                .then(() => sendResponse({status: "Refinement process initiated."}))
                .catch(error => console.error('[Forcefield BG] Error handling refineSystemPrompt command:', error));
            return true; // Indicates async response
        }
    })(); // Immediately-invoked async function
    return true; // Indicates that the response is sent asynchronously
});

// Helper function to check if a given URL is on the allowed list
async function isSiteAllowed(url) {
    if (!url) return false;
    return new Promise((resolve) => {
        chrome.storage.sync.get(['allowedSites'], (result) => {
            const sites = result.allowedSites || [];
            if (sites.length === 0) {
                resolve(true); // Allow all if list is empty
                return;
            }
            try {
                const urlHostname = new URL(url).hostname;
                // Exact host or subdomain only — a bare endsWith('x.com') would match netflix.com.
                const match = sites.some(site => urlHostname === site || urlHostname.endsWith('.' + site));
                resolve(match);
            } catch (e) {
                console.warn("[Forcefield BG] Could not parse URL for site check:", url, e);
                resolve(false);
            }
        });
    });
}

async function handleStartScan(tabId) {
    console.log(`[Forcefield BG] Handling start scan for tab ${tabId}`);
    // When starting, first stop any previously active scan
    const { activeScanTabId } = await chrome.storage.local.get(['activeScanTabId']);
    if (activeScanTabId && activeScanTabId !== tabId) {
        stopObserverInTab(activeScanTabId);
    }
    // Set the new active tab and start its observer
    await chrome.storage.local.set({ isScanning: true, activeScanTabId: tabId });
    startObserverInTab(tabId);
    updatePopupStatus('Scanning active.');
}

async function handleStopScan(tabId) {
    console.log(`[Forcefield BG] Handling stop scan for tab ${tabId}`);
    await chrome.storage.local.set({ isScanning: false, activeScanTabId: null });
    // This function might be called with the last known active tab ID.
    // We should try to stop it, but also check all tabs in case state is weird.
    if (tabId) {
        stopObserverInTab(tabId);
    }
    // Also broadcast a stop command to all content scripts to be safe.
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.id) stopObserverInTab(tab.id);
    }
    updatePopupStatus('Scanning stopped.');
}

// This is the new implementation of processNewContentWithAIBackground
async function processNewContentWithAIBackground(text, tabId, originalSendResponse) {
    const onMessageLogPrefix = `[Forcefield BG OnMessage - Cmd: newContentDetected]`;
    let responseSent = false;

    function safeSendResponse(responseArg) {
        if (!responseSent) {
            originalSendResponse(responseArg);
            responseSent = true;
        } else {
            console.log(`${onMessageLogPrefix} Attempted to send response multiple times for tab ${tabId}. Suppressed additional send.`);
        }
    }

    console.log(`${onMessageLogPrefix} Received from tab: ${tabId}`);

    try {
        const result = await chrome.storage.local.get(['isScanning', 'activeScanTabId']);

        if (!(result.isScanning && result.activeScanTabId === tabId)) {
            const reason = !result.isScanning
                ? "Global scanning is off"
                : `Content from inactive tab ${tabId} (active is ${result.activeScanTabId})`;
            console.log(`${onMessageLogPrefix} Content from tab ${tabId} will be ignored. Reason: ${reason}.`);
            safeSendResponse({status: "Content ignored by background", reason: reason});
            return;
        }

        if (ongoingScans[tabId]) {
            // A scan is already in flight for this tab. BUFFER the text instead of
            // dropping it (AI calls take seconds; dropping meant most scrolled
            // content was never analyzed). It is processed as a follow-up scan
            // as soon as the current one finishes.
            const combined = (pendingScanText[tabId] ? pendingScanText[tabId] + '\n\n' : '') + text;
            pendingScanText[tabId] = combined.slice(-12000); // keep the newest content, cap growth
            console.log(`${onMessageLogPrefix} Scan in progress for tab ${tabId}; buffered ${text.length} chars for follow-up.`);
            safeSendResponse({status: "Scan in progress, content buffered"});
            return;
        }

        ongoingScans[tabId] = true;
        console.log(`${onMessageLogPrefix} Processing content for tab ${tabId}.`);
        safeSendResponse({status: "Content received and is being processed"}); // Acknowledge receipt
        try {
            await handleNewContent(text, tabId);
            // Drain anything that arrived while we were scanning.
            while (pendingScanText[tabId]) {
                const followUp = pendingScanText[tabId];
                delete pendingScanText[tabId];
                console.log(`${onMessageLogPrefix} Processing ${followUp.length} buffered chars for tab ${tabId}.`);
                await handleNewContent(followUp, tabId);
            }
        } finally {
            // Cleared here — NOT in an outer finally, which used to release the
            // lock from the "ignored" branch while another scan was still running.
            delete ongoingScans[tabId];
        }
    } catch (error) {
        console.error(`${onMessageLogPrefix} Error processing new content:`, error);
        safeSendResponse({status: "Error processing content", error: error.message});
    }
}

// In-memory per-tab scan locks and overflow buffers. Reset when the service
// worker sleeps, which is fine — a lost buffer just means the next mutation
// batch re-sends fresh content.
const ongoingScans = {};
const pendingScanText = {};


async function handleNewContent(text, tabId) {
    const logPrefix = `[Forcefield BG HandleContent - Tab: ${tabId}]`;
    console.log(`${logPrefix} Received new content. Length: ${text.length}`);
    
    try {
        const syncData = await chrome.storage.sync.get(['customSystemPrompt', 'customUserPromptPrefix', 'selectedAiModel', 'anthropicApiKey', 'geminiApiKey']);
        const localData = await chrome.storage.local.get(['whiteboxMode', 'debugMode']);
        const allConfig = { ...syncData, ...localData };

        const systemPrompt = allConfig.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
        const userPromptPrefix = allConfig.customUserPromptPrefix !== undefined ? allConfig.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX;
        const aiModel = allConfig.selectedAiModel || DEFAULT_AI_MODEL;
        const provider = providerForModel(aiModel);
        const keyForProvider = provider === 'google' ? allConfig.geminiApiKey : allConfig.anthropicApiKey;

        if (!keyForProvider) {
            console.warn(`${logPrefix} ${provider === 'google' ? 'Gemini' : 'Anthropic'} API Key is not set. Cannot perform analysis.`);
            return;
        }

        const userPrompt = `${userPromptPrefix}${text}${DEFAULT_USER_PROMPT_SUFFIX}`;

        console.log(`${logPrefix} Sending request to AI via ${provider} (${aiModel})...`);
        // Surface the scan in the *page* console too, so behaviour is visible
        // without opening the service-worker console.
        logToPageConsole(tabId, `[Forcefield AI] Scanning ${text.length} chars via ${provider} (${aiModel})…`);
        // cacheSystem: this is the hot path — cache the stable system prefix so
        // repeated scans in a session re-read it cheaply (once it's large enough).
        const aiResponseContent = await callLLM({
            model: aiModel,
            system: systemPrompt,
            userText: userPrompt,
            maxTokens: 4096,
            anthropicApiKey: allConfig.anthropicApiKey,
            geminiApiKey: allConfig.geminiApiKey,
            cacheSystem: true
        });
        const suggestions = extractNegativeTags(aiResponseContent);

        console.log(`${logPrefix} Received ${suggestions.length} suggestions from AI.`);
        logToPageConsole(tabId, `[Forcefield AI] Flagged ${suggestions.length} statement(s).`, suggestions);

        if (suggestions.length > 0) {
            await addSuggestionsToBlocklist(suggestions, tabId, allConfig.whiteboxMode, allConfig.debugMode);
        }

        // ALWAYS re-apply the current blocklist after a scan — even with zero new
        // suggestions. X virtualizes the timeline (posts leave and re-enter the DOM),
        // so newly rendered posts matching EXISTING entries would otherwise never
        // get hidden/highlighted.
        const { blockList } = await chrome.storage.local.get(['blockList']);
        if (blockList && blockList.length > 0) {
            triggerPageBlock(tabId, blockList, allConfig.debugMode || false, allConfig.whiteboxMode || false);
        }

    } catch (error) {
        console.error(`${logPrefix} Error during AI analysis:`, error);
        logToPageConsole(tabId, `[Forcefield AI] ERROR during analysis: ${error.message}`);
    }
}


async function addSuggestionsToBlocklist(suggestions, tabId, whiteboxMode, debugMode) {
    const tab = await chrome.tabs.get(tabId);
    const defaultLevel = getDefaultLevelForSite(tab.url);

    const { blockList } = await chrome.storage.local.get(['blockList']);
    let currentBlockList = blockList || [];
    let newSuggestions = [];

    suggestions.forEach(word => {
        const trimmedWord = word.trim();
        if (trimmedWord && !currentBlockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
            currentBlockList.push({ text: trimmedWord, level: defaultLevel, source: 'ai_continuous' });
            newSuggestions.push(trimmedWord);
        }
    });

    if (newSuggestions.length > 0) {
        console.log(`[Forcefield BG] Adding ${newSuggestions.length} new AI suggestions to the blocklist.`);
        await chrome.storage.local.set({ blockList: currentBlockList });
        
        chrome.runtime.sendMessage({ command: "blockListUpdated", newSuggestions: newSuggestions })
            .catch(err => {/* Popup not open, ignore error */});
        // Note: the page re-block is triggered by handleNewContent after this
        // returns (it re-applies the list unconditionally), so no trigger here.
    }
}

// Utility to start the observer in a specific tab
async function startObserverInTab(tabId) {
    const sendMessagePromise = (tabId, message) => {
        return new Promise((resolve, reject) => {
            // We can't send messages to tabs that are not yet loaded
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    return reject(new Error(chrome.runtime.lastError.message));
                }
                if (tab.status !== 'complete') {
                    return reject(new Error('Tab is not completely loaded.'))
                }
                chrome.tabs.sendMessage(tabId, message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(response);
                    }
                });
            });
        });
    };

    try {
        await sendMessagePromise(tabId, { command: "startObserving" });
        console.log(`[Forcefield BG] Observer started on already-injected tab ${tabId}.`);
    } catch (e) {
        console.log(`[Forcefield BG] Content script not ready on tab ${tabId} ("${e.message}"). Injecting now.`);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['continuousScan.js'],
            });
            // After injecting, send the message again.
            await sendMessagePromise(tabId, { command: "startObserving" });
            console.log(`[Forcefield BG] Injected script and started observer on tab ${tabId}.`);
        } catch (injectionError) {
            console.error(`[Forcefield BG] Could not inject script or start observer on tab ${tabId}. It might be a protected page. Error:`, injectionError.message);
        }
    }
}

// Utility to stop the observer in a specific tab
function stopObserverInTab(tabId) {
    chrome.tabs.sendMessage(tabId, { command: "stopObserving" }, (response) => {
        if (chrome.runtime.lastError) {
            console.warn(`[Forcefield BG] Could not stop observer in tab ${tabId}:`, chrome.runtime.lastError.message, "- This is expected if the tab is closed or script not present.");
        }
    });
}

// Utility to update the popup's status display
function updatePopupStatus(statusText) {
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: statusText })
        .catch(err => { /* Popup not open, ignore error */ });
} 