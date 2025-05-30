// --- VERY INSECURE - DO NOT USE IN PRODUCTION --- //
// Replace with a secure method
const ANTHROPIC_API_KEY = 'REDACTED_ANTHROPIC_API_KEY';
// --- END INSECURE SECTION --- //

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
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku'
};
const DEFAULT_AI_MODEL = 'claude-3-5-sonnet-20240620';

let currentAiCallAbortController = null;
let activeScanTabId = null; // Keep track of which tab is being scanned

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
    console.error('[Forcefield Background] Failed to log message to page console (tabId: ', tabId, '):', error, 'Args:', ...args);
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
function actualContentBlockingFunction(blockListToUse, debugMode) {
    function normalizeApostrophes(str) {
        if (!str) return str;
        return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'");
    }

    const hiddenMarker = 'hiddenByForcefield';
    const debugHighlightClass = 'forcefield-debug-highlight';
    const debugHighlightStyle = 'background-color: rgba(255, 0, 0, 0.3) !important; border: 1px solid red !important; display: revert !important; visibility: revert !important;';

    // First, reset all previously affected elements
    const previouslyAffected = document.querySelectorAll(`[data-${hiddenMarker}], .${debugHighlightClass}`);
    previouslyAffected.forEach(el => {
        el.style.display = '';
        el.style.border = '';
        el.style.backgroundColor = '';
        el.classList.remove(debugHighlightClass);
        delete el.dataset[hiddenMarker];
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
        if (element.style.display === 'none' && !element.dataset[hiddenMarker] && !element.classList.contains(debugHighlightClass)) {
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
                } else {
                    if (elementToHide.style.display !== 'none') {
                        elementToHide.style.display = 'none';
                        elementToHide.dataset[hiddenMarker] = 'true';
                        elementsAffected++;
                    }
                }
            } else if (elementToHide && (elementToHide.style.display === 'none' || elementToHide.classList.contains(debugHighlightClass))) {
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
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: actualContentBlockingFunction,
        args: [blockList, debugMode]
    }).catch(err => console.error(`[Forcefield Background] Error in executeScript for triggerPageBlock on tab ${tabId}:`, err));
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
            console.error(`[Forcefield Background] Error getting tab URL for tabId ${tabIdForContext}:`, e);
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

async function processNewContentWithAIBackground(text, tabId) {
    if (!tabId) {
        console.warn('[Forcefield Background] processNewContentWithAIBackground called without tabId.');
        return;
    }

    console.log(`[Forcefield Background] Processing new text chunk for tab ${tabId}...`);
    // Optional: Send status to popup if open
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "AI processing new content..."}).catch(e => {});

    if (currentAiCallAbortController) {
        console.warn('[Forcefield Background] Aborting previous AI call due to new content.');
        currentAiCallAbortController.abort();
    }
    currentAiCallAbortController = new AbortController();
    const signal = currentAiCallAbortController.signal;

    try {
        const [storageSystemPrompt, storageUserPrompt, storageModel, storageIsScanning, storageDebugMode] = await Promise.all([
            chrome.storage.sync.get(['customSystemPrompt']),
            chrome.storage.sync.get(['customUserPromptPrefix']),
            chrome.storage.sync.get(['selectedAiModel']),
            chrome.storage.local.get(['isScanning']), // Check if scanning is still globally active
            chrome.storage.local.get(['debugMode']) // Get debugMode state
        ]);

        if (!storageIsScanning.isScanning) {
            console.log('[Forcefield Background] Global scanning is off. Aborting AI processing.');
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "Processing aborted (scan stopped)."}).catch(e => {});
            return;
        }
        // Also check if this specific tab is the active one for scanning
        // This is a simple check; a more robust system might store scanning state per tab.
        if (activeScanTabId !== tabId) {
             console.log(`[Forcefield Background] Tab ${tabId} is not the active scanning tab (${activeScanTabId}). Ignoring content.`);
             return;
        }

        const currentSystemPrompt = storageSystemPrompt.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
        const currentUserPromptPrefix = storageUserPrompt.customUserPromptPrefix !== undefined ? storageUserPrompt.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX;
        const selectedModel = storageModel.selectedAiModel || DEFAULT_AI_MODEL;
        const currentAiModel = AVAILABLE_AI_MODELS[selectedModel] ? selectedModel : DEFAULT_AI_MODEL;

        const userPrompt = `${currentUserPromptPrefix}${text}${DEFAULT_USER_PROMPT_SUFFIX}`;
        const requestBody = {
            model: currentAiModel,
            max_tokens: 4096,
            temperature: 0.5,
            system: currentSystemPrompt,
            messages: [{ role: "user", content: userPrompt }]
        };

        logToPageConsole(tabId, '[Forcefield AI - Continuous BG] Sending prompt. Body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody),
            signal: signal
        });

        if (signal.aborted) {
            console.log('[Forcefield Background] API call aborted.');
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "AI processing aborted."}).catch(e => {});
            return;
        }

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const result = await response.json();
        logToPageConsole(tabId, '[Forcefield AI - Continuous BG] Received response from Claude:', result);

        let aiResponseContent = '';
        if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
            aiResponseContent = result.content[0].text;
        }

        const suggestions = extractNegativeTags(aiResponseContent);
        console.log('[Forcefield Background] Extracted suggestions:', suggestions);
        logToPageConsole(tabId, '[Forcefield AI - Continuous BG] Extracted suggestions:', suggestions);

        if (suggestions.length > 0) {
            const currentDebugMode = storageDebugMode.debugMode || false; // Use fetched debugMode
            const updatedBlockList = await addSuggestedWords(suggestions, null, 'ai_continuous_bg', tabId);
            if (updatedBlockList && updatedBlockList.length > 0) {
                triggerPageBlock(tabId, updatedBlockList, currentDebugMode); // Pass currentDebugMode
            }
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Processed: ${suggestions.length} new blocks. Re-blocking.`}).catch(e => {});
        } else {
            logToPageConsole(tabId, '[Forcefield AI - Continuous BG] No new suggestions found.');
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'AI found no new items to block.'}).catch(e => {});
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('[Forcefield Background] Fetch aborted as expected.');
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'AI processing aborted.'}).catch(e => {});
        } else {
            console.error('[Forcefield Background] Error during AI processing:', error);
            logToPageConsole(tabId, '[Forcefield AI - Continuous BG] Error during AI processing:', error.message);
            chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Error: ${error.message.substring(0,50)}...`}).catch(e => {});
        }
    } finally {
        currentAiCallAbortController = null;
        // Update popup status if still scanning
        chrome.storage.local.get(['isScanning'], (res) => {
            if (res.isScanning && activeScanTabId === tabId) {
                 chrome.runtime.sendMessage({ command: "scanningStateChanged", status: 'Scanning active...'}).catch(e => {});
            }
        });
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === "newContentDetected") {
        console.log('[Forcefield Background] Received newContentDetected from tab:', sender.tab ? sender.tab.id : 'unknown tab');
        if (sender.tab && sender.tab.id) {
            // Check if scanning is enabled for this tab or globally
            chrome.storage.local.get(['isScanning'], (result) => {
                if (result.isScanning && sender.tab.id === activeScanTabId) {
                    processNewContentWithAIBackground(request.text, sender.tab.id);
                    sendResponse({status: "Text received by background for AI processing"});
                } else {
                    console.log(`[Forcefield Background] Received content from tab ${sender.tab.id}, but scanning is off or not for this tab.`);
                    sendResponse({status: "Scanning off or wrong tab, content ignored by background"});
                }
            });
            return true; // Indicate async response
        }
    } else if (request.command === "startContinuousScanBG") { // New command from popup
        activeScanTabId = request.tabId;
        console.log(`[Forcefield Background] Service worker instructed to start/monitor continuous scan for tab ${request.tabId}`);
        // The actual observer is started by popup.js in the content script.
        // Service worker just needs to know which tab it should process messages from.
        sendResponse({status: "Background aware of scan start"});
    } else if (request.command === "stopContinuousScanBG") { // New command from popup
        console.log(`[Forcefield Background] Service worker instructed to stop scan for tab ${request.tabId}`);
        if (activeScanTabId === request.tabId) {
            activeScanTabId = null;
            if (currentAiCallAbortController) {
                currentAiCallAbortController.abort();
                currentAiCallAbortController = null;
                console.log('[Forcefield Background] Aborted ongoing AI call due to scan stop instruction.');
            }
        }
        sendResponse({status: "Background aware of scan stop"});
    } else if (request.command === "getActiveScanTabId") {
        // New command to get which tab is actively being scanned
        sendResponse({activeScanTabId: activeScanTabId});
    } else if (request.command === "getGlobalScanningState") {
        // Command from content script to check if scanning should be active
        chrome.storage.local.get(['isScanning'], (result) => {
            sendResponse({isScanningGlobally: result.isScanning || false});
        });
        return true; // Keep channel open for async response
    } else if (request.command === "getCurrentTabId") {
        // Command from content script to get its own tab ID
        if (sender.tab && sender.tab.id) {
            sendResponse({tabId: sender.tab.id});
        } else {
            sendResponse({tabId: null});
        }
    }
    // Add other message handlers if needed, e.g., for status updates from content script

    return true; // Keep channel open for other async responses if any other handlers need it
});

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const newTabId = activeInfo.tabId;
    console.log(`[Forcefield Background] Tab activated: ${newTabId}`);

    const { isScanning } = await chrome.storage.local.get(['isScanning']);
    if (!isScanning) {
        // console.log('[Forcefield Background] Tab activated, but global scanning is off. No action.');
        return;
    }

    const previousActiveScanTabId = activeScanTabId;

    if (previousActiveScanTabId && previousActiveScanTabId !== newTabId) {
        // Stop observer on the previously active tab
        console.log(`[Forcefield Background] Attempting to stop observer on old tab ${previousActiveScanTabId}`);
        chrome.tabs.sendMessage(previousActiveScanTabId, { command: "stopObserving" })
            .catch(err => console.warn(`[Forcefield Background] Error sending stopObserving to old tab ${previousActiveScanTabId}: ${err.message}. Tab might be closed.`));
    }

    // Update activeScanTabId to the new tab
    activeScanTabId = newTabId;
    console.log(`[Forcefield Background] Active scan tab updated to: ${activeScanTabId}`);

    // Attempt to start observer on the newly activated tab
    // We need to ensure the content script is there first.
    try {
        // Check if the tab is already loaded, otherwise onUpdated will handle it.
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
    
    // Update popup status if it were open (though it usually closes on tab switch)
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: `Scanning tab ${newTabId}...`}).catch(e => {});
});

// Listen for tab updates (e.g., new URL loaded, page finished loading)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // We are interested when the tab has finished loading content
    if (changeInfo.status === 'complete' && tab.url && (tab.url.startsWith('http://') || tab.url.startsWith('https://'))) {
        console.log(`[Forcefield Background] Tab updated and complete: ${tabId}, URL: ${tab.url}`);

        const { isScanning } = await chrome.storage.local.get(['isScanning']);
        if (!isScanning) {
            // console.log(`[Forcefield Background] Tab ${tabId} updated, but global scanning is off.`);
            return;
        }

        // Only proceed if this is the currently active tab that should be scanned
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
            // console.log(`[Forcefield Background] Tab ${tabId} updated, but it's not the active scan tab (${activeScanTabId}).`);
        }
    }
});

console.log("[Forcefield Background] Service worker started."); 