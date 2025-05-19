// Constants
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

const DEFAULT_USER_PROMPT_PREFIX = `Analyze the following text content and extract potentially controversial, politically charged, or negative statements using <Negative> tags as instructed:\n\n----\n`;
const DEFAULT_USER_PROMPT_SUFFIX = `\n----\n\nRemember to only return the tagged statements, nothing else.`;

// --- VERY INSECURE - DO NOT USE IN PRODUCTION --- //
const ANTHROPIC_API_KEY = 'REDACTED_ANTHROPIC_API_KEY';
// --- END INSECURE SECTION --- //

// Global variables to track scanning state
let isScanning = false;
let observer = null;
let abortController = null;
let scanTimeout = null; // For debouncing scanNewContent
const DEBOUNCE_DELAY = 1000; // milliseconds (1 second)

console.log('[Forcefield - contentScanner.js] Script execution started.');

// Helper function to normalize different apostrophe/single quote characters
function normalizeApostrophes(str) {
    if (!str) return str;
    return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'"); // Replaces ‘ ’ ` ´ with standard '
}

// Function to start scanning
function startScanning() {
    if (isScanning) return;
    isScanning = true;
    
    // Create new AbortController for API calls
    abortController = new AbortController();
    
    // Set up MutationObserver to watch for new content
    observer = new MutationObserver((mutations) => {
        // Debounce the scanning of new content
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            console.log('[Forcefield - contentScanner.js] Debounced mutation observer triggered.');
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // It might be better to collect all unique new top-level nodes 
                            // from this batch of mutations and scan them, 
                            // rather than calling scanNewContent for each one individually 
                            // if multiple are added in the same debounced interval.
                            // For now, we call it per node, but this is an area for optimization.
                            scanNewContent(node); 
                        }
                    });
                }
            });
        }, DEBOUNCE_DELAY);
    });
    
    // Start observing the document
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // Send message to background script that scanning has started
    chrome.runtime.sendMessage({ action: 'scanningStarted' });
}

// Function to stop scanning
function stopScanning() {
    if (!isScanning) return;
    isScanning = false;
    
    // Disconnect the observer
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    
    // Abort any in-progress API calls
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    
    // Send message to background script that scanning has stopped
    chrome.runtime.sendMessage({ action: 'scanningStopped' });
}

// Function to scan new content
async function scanNewContent(element) {
    if (!isScanning) return;
    
    try {
        // Extract text content from the element
        const text = element.innerText;
        if (!text || text.trim() === '') return;
        
        // Get the current system prompt and user prompt prefix
        const { customSystemPrompt, customUserPromptPrefix, selectedAiModel } = await chrome.storage.sync.get([
            'customSystemPrompt',
            'customUserPromptPrefix',
            'selectedAiModel'
        ]);
        
        // Prepare the API request
        const requestBody = {
            model: selectedAiModel || 'claude-3-5-sonnet-20240620',
            max_tokens: 4096,
            temperature: 0.5,
            system: customSystemPrompt || DEFAULT_SYSTEM_PROMPT,
            messages: [{
                role: "user",
                content: `${customUserPromptPrefix || DEFAULT_USER_PROMPT_PREFIX}${text}${DEFAULT_USER_PROMPT_SUFFIX}`
            }]
        };
        
        // Make the API call
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }
        
        const result = await response.json();
        
        if (!chrome.runtime?.id) {
            console.warn('[Forcefield - contentScanner.js] Context invalidated after API response (scanNewContent). Aborting.');
            if (abortController && !abortController.signal.aborted) {
                abortController.abort(); // Attempt to clean up ongoing fetch if somehow not already done
            }
            return; // Exit early
        }
        
        // Extract content from the response
        let aiResponseContent = '';
        if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
            aiResponseContent = result.content[0].text;
        }
        
        // Parse the response to find <Negative> tags
        const suggestions = extractNegativeTags(aiResponseContent);
        
        if (suggestions.length > 0) {
            // Add suggestions to the blocklist
            await addSuggestedWords(suggestions);
            
            // Apply blocking to the new content
            const blockList = await getBlockList();
            blockListedContent(blockList);
        }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Scanning was stopped, API call aborted');
        } else {
            console.error('Error scanning new content:', error);
        }
    }
}

// Helper function to get the current blocklist
async function getBlockList() {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) {
            console.warn('[Forcefield - contentScanner.js] Context invalidated before calling storage.get (getBlockList).');
            resolve([]); // Resolve with empty to prevent further errors
            return;
        }
        chrome.storage.sync.get(['blockList'], (result) => {
            // Check context again, as the callback is asynchronous
            if (!chrome.runtime?.id) {
                console.warn('[Forcefield - contentScanner.js] Context invalidated in storage.get callback (getBlockList).');
                resolve([]);
                return;
            }
            if (chrome.runtime.lastError) {
                console.error('[Forcefield - contentScanner.js] Error getting blocklist:', chrome.runtime.lastError.message);
                resolve([]); // Resolve with empty on error
                return;
            }
            resolve(result.blockList || []);
        });
    });
}

// Helper function to extract <Negative> tags
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

// Helper function to add suggested words to the blocklist
async function addSuggestedWords(suggestions) {
    return new Promise((resolve) => {
        if (!chrome.runtime?.id) {
            console.warn('[Forcefield - contentScanner.js] Context invalidated before calling storage.get (addSuggestedWords).');
            resolve(0);
            return;
        }
        chrome.storage.sync.get(['blockList'], (result) => {
            if (!chrome.runtime?.id) {
                console.warn('[Forcefield - contentScanner.js] Context invalidated in storage.get callback (addSuggestedWords).');
                resolve(0);
                return;
            }
            if (chrome.runtime.lastError) {
                console.error('[Forcefield - contentScanner.js] Error getting blocklist for suggestions:', chrome.runtime.lastError.message);
                resolve(0);
                return;
            }

            let blockList = result.blockList || [];
            let addedCount = 0;
            
            suggestions.forEach(word => {
                const trimmedWord = word.trim();
                if (trimmedWord && !blockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
                    blockList.push({ text: trimmedWord, level: 1, source: 'ai' }); 
                    addedCount++;
                }
            });
            
            if (addedCount > 0) {
                if (!chrome.runtime?.id) {
                     console.warn('[Forcefield - contentScanner.js] Context invalidated before calling storage.set (addSuggestedWords).');
                     resolve(0); // Resolve, but acknowledge data might not have been saved
                     return;
                }
                chrome.storage.sync.set({ blockList }, () => {
                    if (!chrome.runtime?.id && chrome.runtime.lastError) { 
                         console.warn('[Forcefield - contentScanner.js] Context invalidated or error in storage.set callback (addSuggestedWords):_response', chrome.runtime.lastError?.message);
                         resolve(0); 
                         return;
                    }
                    // If context became invalid but no lastError, it might mean the set operation was interrupted or its callback won't fire reliably.
                    // However, if lastError is not set, Chrome usually considers the operation successful from its perspective before invalidation.
                    resolve(addedCount);
                });
            } else {
                resolve(0);
            }
        });
    });
}

// Moved from popup.js (originally part of injectContentScript)
function blockListedContent(blockList) {
    // console.log(`[Forcefield] Starting scan for ${blockList.length} words/phrases.`); // Less verbose
    const allElements = document.body.getElementsByTagName('*');
    let elementsHidden = 0;
    const hiddenMarker = 'hiddenByForcefield'; // Use a constant for the dataset key

    // Iterate backwards through all elements
    for (let i = allElements.length - 1; i >= 0; i--) {
        const element = allElements[i];

        if (element.style.display === 'none' && !element.dataset[hiddenMarker]) {
            continue;
        }

        let foundMatch = null;
        let matchedBlockItem = null;

        for (const childNode of element.childNodes) {
            if (childNode.nodeType === 3 && childNode.nodeValue && childNode.nodeValue.trim()) {
                const normalizedNodeText = normalizeApostrophes(childNode.nodeValue).toLowerCase();
                for (const item of blockList) {
                    const normalizedBlockText = normalizeApostrophes(item.text).toLowerCase();
                    if (normalizedNodeText.includes(normalizedBlockText)) {
                        foundMatch = element;
                        matchedBlockItem = item;
                        break;
                    }
                }
            }
            if (foundMatch) {
                break;
            }
        }

        if (foundMatch && matchedBlockItem) {
            const levelsToAscend = matchedBlockItem.level;
            let elementToHide = foundMatch;
            let actualLevelsAscended = 0;
            for (let j = 0; j < levelsToAscend && elementToHide.parentElement; j++) {
                if (elementToHide.parentElement === document.body || elementToHide.parentElement === document.documentElement) {
                    if (levelsToAscend > 0) {
                        console.warn(`[Forcefield] Ascent for "${matchedBlockItem.text}" (level ${levelsToAscend}) stopped early at level ${j} to avoid hiding BODY/HTML. Hiding current element instead:`, elementToHide);
                    }
                    break;
                }
                elementToHide = elementToHide.parentElement;
                actualLevelsAscended++;
            }

            if (elementToHide && elementToHide !== document.body && elementToHide !== document.documentElement && elementToHide.style.display !== 'none') {
                // console.log(`[Forcefield] Hiding element (level ${actualLevelsAscended} ancestor) for "${matchedBlockItem.text}":`, elementToHide);
                elementToHide.style.display = 'none';
                elementToHide.dataset[hiddenMarker] = 'true';
                elementsHidden++;
            } else if (elementToHide && elementToHide.style.display === 'none' && elementToHide.dataset[hiddenMarker]) {
                // Already hidden by this script
            } else if (elementToHide === document.body || elementToHide === document.documentElement) {
                 console.warn(`[Forcefield] Avoided hiding BODY/HTML directly for "${matchedBlockItem.text}". Element was likely too high or level too large.`);
            }
        }
    }
    if (elementsHidden > 0) {
        // console.log(`[Forcefield] Scan finished. Hid ${elementsHidden} elements/ancestors.`);
    } else {
        // console.log(`[Forcefield] Scan finished. No new elements hidden.`);
    }
}

// Listen for messages from the popup
console.log('[Forcefield - contentScanner.js] Attempting to add message listener.');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startScanning') {
        startScanning();
        sendResponse({ success: true });
    } else if (message.action === 'stopScanning') {
        stopScanning();
        sendResponse({ success: true });
    }
    return true;
});

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        startScanning,
        stopScanning,
        scanNewContent,
        extractNegativeTags
    };
} 