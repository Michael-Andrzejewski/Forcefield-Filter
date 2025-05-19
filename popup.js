const wordInput = document.getElementById('wordInput');
const addButton = document.getElementById('addButton');
const blockListDiv = document.getElementById('blockList');
const blockButton = document.getElementById('blockButton');
const aiSuggestButton = document.getElementById('aiSuggestButton');
const clearAllButton = document.getElementById('clearAllButton');
const systemPromptText = document.getElementById('systemPromptText');
const saveSystemPromptButton = document.getElementById('saveSystemPromptButton');
const resetSystemPromptButton = document.getElementById('resetSystemPromptButton');
const userPromptPrefixText = document.getElementById('userPromptPrefixText');
const saveUserPromptPrefixButton = document.getElementById('saveUserPromptPrefixButton');
const resetUserPromptPrefixButton = document.getElementById('resetUserPromptPrefixButton');
const aiModelSelect = document.getElementById('aiModelSelect');

// --- VERY INSECURE - DO NOT USE IN PRODUCTION --- //
// Replace with a secure method (e.g., backend server call)
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
const DEFAULT_USER_PROMPT_PREFIX = `Analyze the following text content and extract potentially controversial, politically charged, or negative statements using <Negative> tags as instructed:\n\n----\n`;
const DEFAULT_USER_PROMPT_SUFFIX = `\n----\n\nRemember to only return the tagged statements, nothing else.`; // Suffix remains constant for now

// AI Model Configuration
const AVAILABLE_AI_MODELS = {
    'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet (New)',
    'claude-3-opus-20240229': 'Claude 3 Opus',
    'claude-3-sonnet-20240229': 'Claude 3 Sonnet (Older)',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku'
};
const DEFAULT_AI_MODEL = 'claude-3-5-sonnet-20240620';

// Load and display the blocklist and system prompt when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    loadBlockList();
    loadSystemPrompt();
    loadUserPromptPrefix();
    loadAiModelSelection();
});

// Add word to blocklist
addButton.addEventListener('click', addWord);
wordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addWord();
  }
});

// Trigger content script
blockButton.addEventListener('click', () => {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    if (blockList.length === 0) {
        console.log("Blocklist is empty. Nothing to block.");
        // Optionally, provide user feedback here, e.g., alert("Blocklist is empty.")
        return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: injectContentScript,
          args: [blockList] // Pass the blocklist (now array of objects)
        }).catch(err => console.error("Error injecting script: ", err));
      } else {
        console.error("Could not get active tab ID.");
      }
    });
  });
});

// Add listener for the AI Suggest button
aiSuggestButton.addEventListener('click', getAiSuggestions);

// Add listener for the Clear All button
clearAllButton.addEventListener('click', clearAllBlocks);

// Add listeners for System Prompt buttons
saveSystemPromptButton.addEventListener('click', saveSystemPrompt);
resetSystemPromptButton.addEventListener('click', resetSystemPrompt);

// Add listeners for User Prompt Prefix buttons
saveUserPromptPrefixButton.addEventListener('click', saveUserPromptPrefix);
resetUserPromptPrefixButton.addEventListener('click', resetUserPromptPrefix);

// Add listener for AI Model selection change
aiModelSelect.addEventListener('change', saveAiModelSelection);

function loadBlockList() {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    displayBlockList(blockList);
  });
}

function displayBlockList(list) {
  blockListDiv.innerHTML = ''; // Clear current list
  list.forEach((item, index) => { // Item is now { text: '...', level: ... }
    const tag = document.createElement('span');
    tag.className = 'tag';

    const text = document.createElement('span');
    text.textContent = item.text; // Use item.text
    tag.appendChild(text);

    // Create number input for level
    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.value = item.level; // Use item.level
    levelInput.min = 0;
    levelInput.max = 100;
    levelInput.title = 'Parent levels to hide';
    levelInput.addEventListener('change', (e) => updateLevel(index, parseInt(e.target.value, 10)));
    levelInput.addEventListener('input', (e) => {
        // Optional: Clamp value immediately on input if needed, though 'change' is usually sufficient
        let value = parseInt(e.target.value, 10);
        if (isNaN(value)) value = 0; // Default to 0 if invalid
        if (value < 0) e.target.value = 0;
        if (value > 100) e.target.value = 100;
    });
    tag.appendChild(levelInput);

    const removeButton = document.createElement('button');
    removeButton.textContent = 'x';
    removeButton.title = 'Remove'; // Add tooltip
    removeButton.addEventListener('click', () => removeWord(index));
    tag.appendChild(removeButton);

    blockListDiv.appendChild(tag);
  });
}

// Function to determine the default block level based on the site URL
function getDefaultLevelForSite(url) {
    const defaultLevel = 1;
    const siteDefaults = {
        'twitter.com': 8,
        'x.com': 8, // Add alias for twitter
        'quora.com': 10
    };

    try {
        const hostname = new URL(url).hostname;
        // Remove www. if present
        const effectiveHostname = hostname.startsWith('www.') ? hostname.substring(4) : hostname;

        if (siteDefaults.hasOwnProperty(effectiveHostname)) {
            console.log(`[Forcefield] Using site-specific default level ${siteDefaults[effectiveHostname]} for ${effectiveHostname}`);
            return siteDefaults[effectiveHostname];
        }
    } catch (e) {
        console.error("[Forcefield] Could not parse URL for default level:", url, e);
    }

    return defaultLevel; // Default level if no site match or error
}

// Make addWord async to fetch tab URL
// async function addWord() { // <-- Reverted: Make sync again
function addWord() {
  const word = wordInput.value.trim();
  if (word) {
    // Get current tab URL to determine default level
    // let defaultLevel = 1; // Fallback default <-- Reverted: No need to fetch URL here
    // try {
    //     const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    //     if (tabs[0] && tabs[0].url) {
    //         defaultLevel = getDefaultLevelForSite(tabs[0].url);
    //     } else {
    //         console.warn("[Forcefield] Could not get active tab URL. Using default level 1.");
    //     }
    // } catch (error) {
    //     console.error("[Forcefield] Error getting active tab:", error);
    //     // Keep defaultLevel = 1 in case of error
    // }


    chrome.storage.sync.get(['blockList'], (result) => {
      const blockList = result.blockList || [];
      // Check if the word (text property) already exists
      if (!blockList.some(item => item.text.toLowerCase() === word.toLowerCase())) { // Case-insensitive check
        // Add as an object with the determined default level
        // blockList.push({ text: word, level: defaultLevel }); // <-- Reverted: Use fixed level 1
        blockList.push({ text: word, level: 1 });
        chrome.storage.sync.set({ blockList }, () => {
          // console.log(`Added "${word}" (level ${defaultLevel}) to blocklist.`); // <-- Reverted
          console.log(`Added "${word}" (level 1) to blocklist.`);
          displayBlockList(blockList); // Update display
          wordInput.value = ''; // Clear input
        });
      } else {
          console.log(`"${word}" is already in the blocklist.`);
          wordInput.value = ''; // Clear input even if duplicate
      }
    });
  }
}

function removeWord(indexToRemove) {
  chrome.storage.sync.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    const removedItem = blockList.splice(indexToRemove, 1)[0]; // Remove item at index
    chrome.storage.sync.set({ blockList }, () => {
      console.log(`Removed "${removedItem.text}" from blocklist.`);
      displayBlockList(blockList); // Update display
    });
  });
}

// New function to update the level of a specific item
function updateLevel(index, newLevel) {
    if (isNaN(newLevel) || newLevel < 0 || newLevel > 100) {
        console.error("Invalid level provided. Must be between 0 and 100.");
        // Optionally, reset the input visually here if the browser didn't clamp it
        loadBlockList(); // Reload to reset the view if clamping fails
        return;
    }
    chrome.storage.sync.get(['blockList'], (result) => {
        const blockList = result.blockList || [];
        if (blockList[index]) {
            blockList[index].level = newLevel;
            chrome.storage.sync.set({ blockList }, () => {
                console.log(`Updated level for "${blockList[index].text}" to ${newLevel}.`);
                // No need to call displayBlockList again, the input value is already updated visually.
                // However, if clamping failed, a reload might be needed.
            });
        } else {
            console.error("Attempted to update level for non-existent item at index:", index);
        }
    });
}

// This function will be injected into the content page
function injectContentScript(blockListToUse) { // blockListToUse is [{text: '.', level: ...}]
    // console.log("[Forcefield] Injecting content script with blocklist:", blockListToUse); // Less verbose

    // Helper function to normalize different apostrophe/single quote characters
    function normalizeApostrophes(str) {
        if (!str) return str;
        return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'"); // Replaces ‘ ’ ` ´ with standard '
    }

    function blockListedContent(blockList) {
        console.log(`[Forcefield] Starting scan for ${blockList.length} words/phrases.`);
        const allElements = document.body.getElementsByTagName('*');
        let elementsHidden = 0;
        const hiddenMarker = 'hiddenByForcefield'; // Use a constant for the dataset key

        // Iterate backwards through all elements
        for (let i = allElements.length - 1; i >= 0; i--) {
            const element = allElements[i];

            // Skip elements that are already hidden by means other than this script
            if (element.style.display === 'none' && !element.dataset[hiddenMarker]) {
                continue;
            }

            // Check direct child text nodes for blocked content
            let foundMatch = null;
            let matchedBlockItem = null; // Store the item that caused the match

            for (const childNode of element.childNodes) {
                // Check only text nodes (nodeType 3) that have non-empty content
                if (childNode.nodeType === 3 && childNode.nodeValue && childNode.nodeValue.trim()) {
                    // Normalize and lower-case the text node's value
                    const normalizedNodeText = normalizeApostrophes(childNode.nodeValue).toLowerCase();

                    // Check if this text contains any blocked word/phrase (normalized)
                    for (const item of blockList) {
                        // Normalize and lower-case the blocked item's text
                        const normalizedBlockText = normalizeApostrophes(item.text).toLowerCase();
                        // Use normalized texts for comparison
                        if (normalizedNodeText.includes(normalizedBlockText)) {
                            foundMatch = element; // The element containing the text node is the target
                            matchedBlockItem = item; // Store the matched item
                            break; // Found a match for this text node, stop checking blocklist items
                        }
                    }
                }
                if (foundMatch) {
                    break; // Found a match within this element's children, stop checking child nodes
                }
            }


            // If a match was found in the direct text nodes of this element
            if (foundMatch && matchedBlockItem) { // Need both element and the block item details
                const levelsToAscend = matchedBlockItem.level;

                // Find the target element by ascending the DOM, stopping before body/html
                let elementToHide = foundMatch; // Start ascent from the element containing the text node
                let actualLevelsAscended = 0; // Track how many levels we actually went up
                for (let j = 0; j < levelsToAscend && elementToHide.parentElement; j++) {
                    // Check BEFORE ascending: Is the *next* parent body or html?
                    if (elementToHide.parentElement === document.body || elementToHide.parentElement === document.documentElement) {
                        if (levelsToAscend > 0) { // Only log if we intended to ascend at all
                            console.warn(`[Forcefield] Ascent for "${matchedBlockItem.text}" (level ${levelsToAscend}) stopped early at level ${j} to avoid hiding BODY/HTML. Hiding current element instead:`, elementToHide);
                        }
                        break; // Stop ascending
                    }
                    elementToHide = elementToHide.parentElement;
                    actualLevelsAscended++;
                }


                // Check if the target is valid and not already hidden by this script
                // The check for body/html here is a safeguard, the loop should prevent reaching them directly.
                if (elementToHide && elementToHide !== document.body && elementToHide !== document.documentElement && elementToHide.style.display !== 'none') {

                    // Hide the element and mark it
                    // console.log(`[Forcefield] Hiding element (level ${actualLevelsAscended} ancestor) for "${matchedBlockItem.text}":`, elementToHide); // More accurate log
                    elementToHide.style.display = 'none';
                    elementToHide.dataset[hiddenMarker] = 'true';
                    elementsHidden++;
                } else if (elementToHide && elementToHide.style.display === 'none' && elementToHide.dataset[hiddenMarker]) {
                    // Element already hidden by us, do nothing.
                } else if (elementToHide === document.body || elementToHide === document.documentElement) {
                     // Log if we still somehow ended up targeting body/html (e.g., original element was body/html and level was 0)
                     console.warn(`[Forcefield] Avoided hiding BODY/HTML directly for "${matchedBlockItem.text}". Element was likely too high or level too large.`);
                }
            }
        }
        if (elementsHidden > 0) {
            console.log(`[Forcefield] Scan finished. Hid ${elementsHidden} elements/ancestors.`);
        } else {
            console.log(`[Forcefield] Scan finished. No new elements hidden.`);
        }
    }

    // Run the blocking logic
    blockListedContent(blockListToUse);
}

// --- New AI Suggestion Functionality --- 

// Utility function to log messages to the active tab's console
async function logToPageConsole(tabId, ...args) {
  try {
    // Prepare args: stringify objects/arrays for safer injection
    const preparedArgs = args.map(arg => 
        (typeof arg === 'object' && arg !== null) ? JSON.stringify(arg, null, 2) : arg
    );

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      // Inject a simple function that just calls console.log
      func: (...logs) => { console.log(...logs); },
      args: preparedArgs, // Pass the prepared (potentially stringified) args
    });
  } catch (error) {
    // Log error to popup's console if injection fails
    console.error('Failed to log message to page console:', error);
  }
}

// Function injected into the page to extract text
function extractPageText() {
    // A simple approach; might need refinement for complex pages (e.g., excluding navbars)
    return document.body.innerText;
}

async function getAiSuggestions() {
    console.log('[Forcefield AI] Requesting AI suggestions...');
    aiSuggestButton.textContent = 'Analyzing...'; // Provide visual feedback
    aiSuggestButton.disabled = true;

    // Get the current system prompt
    const currentSystemPrompt = await new Promise((resolve) => {
        chrome.storage.sync.get(['customSystemPrompt'], (result) => {
            resolve(result.customSystemPrompt || DEFAULT_SYSTEM_PROMPT);
        });
    });

    // Get the current user prompt prefix
    const currentUserPromptPrefix = await new Promise((resolve) => {
        chrome.storage.sync.get(['customUserPromptPrefix'], (result) => {
            resolve(result.customUserPromptPrefix !== undefined ? result.customUserPromptPrefix : DEFAULT_USER_PROMPT_PREFIX);
        });
    });

    // Get the current AI model
    const currentAiModel = await new Promise((resolve) => {
        chrome.storage.sync.get(['selectedAiModel'], (result) => {
            const model = result.selectedAiModel || DEFAULT_AI_MODEL;
            if (AVAILABLE_AI_MODELS[model]){
                resolve(model);
            } else {
                resolve(DEFAULT_AI_MODEL); // Fallback
            }
        });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0] && tabs[0].id) {
            try {
                const injectionResults = await chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: extractPageText,
                });

                if (injectionResults && injectionResults[0] && injectionResults[0].result) {
                    const pageText = injectionResults[0].result;
                    // Log extracted text length to page console
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Extracted text length:', pageText.length);

                    // Prepare the prompt and API request
                    const userPrompt = `${currentUserPromptPrefix}${pageText}${DEFAULT_USER_PROMPT_SUFFIX}`;

                    const requestBody = {
                        model: currentAiModel, 
                        max_tokens: 4096, 
                        temperature: 0.5, 
                        system: currentSystemPrompt, 
                        messages: [
                            {
                                role: "user",
                                content: userPrompt
                            }
                        ]
                    };

                    // Log prompt details to page console
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Sending prompt to Claude:', { system: 'System prompt (see popup source)', user: 'User prompt with page text...' /* Avoid logging full page text */ });
                    // Log the *actual* request body to the page console
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Full Request Body:', JSON.stringify(requestBody, null, 2));

                    // --- API Call --- //
                    // WARNING: API Key is exposed client-side. See security note above.
                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01',
                            'content-type': 'application/json',
                            // Required header for direct browser access - ACKNOWLEDGES SECURITY RISK
                            'anthropic-dangerous-direct-browser-access': 'true'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorBody = await response.text();
                        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorBody}`);
                    }

                    const result = await response.json();
                    // Log received response to page console
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Received response from Claude:', result);
                    // Log full raw response to extension console (new)
                    console.log('[Forcefield AI] Full raw response from Claude:', result);

                    // Extract content from the response
                    let aiResponseContent = '';
                    if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
                        aiResponseContent = result.content[0].text;
                    }

                    // Parse the response to find <Negative> tags
                    const suggestions = extractNegativeTags(aiResponseContent);
                    // Log extracted suggestions to page console
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Extracted suggestions:', suggestions);

                    if (suggestions.length > 0) {
                         // Add suggestions to the blocklist (modify addWord logic slightly)
                        addSuggestedWords(suggestions);
                    } else {
                         // Log no suggestions found to page console
                         await logToPageConsole(tabs[0].id, '[Forcefield AI] No suggestions found in the response.');
                         alert('AI analysis complete. No specific negative statements found to suggest.');
                    }

                } else {
                    // Log error to popup console (as it's an extension-level issue)
                    console.error('[Forcefield AI] Could not extract text from page.');
                    alert('Could not extract text from the page for analysis.');
                }

            } catch (error) {
                 // Log error to popup console (as it's an extension-level issue)
                console.error('[Forcefield AI] Error during AI suggestion process:', error);
                alert(`An error occurred during AI analysis: ${error.message}`);
            } finally {
                aiSuggestButton.textContent = 'Suggest Blocks (AI)'; // Reset button
                aiSuggestButton.disabled = false;
            }
        } else {
            console.error("[Forcefield AI] Could not get active tab ID.");
            alert('Could not get the active tab. Please ensure you have a tab open and selected.');
            aiSuggestButton.textContent = 'Suggest Blocks (AI)'; // Reset button
            aiSuggestButton.disabled = false;
        }
    });
}

// Helper function to parse <Negative> tags
function extractNegativeTags(text) {
    const regex = /<Negative>(.*?)<\/Negative>/gs; // Use gs for global and dotall. Corrected escaping for /
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        // Trim whitespace and ensure it's not empty
        const suggestion = match[1].trim();
        if (suggestion) {
             matches.push(suggestion);
        }
    }
    return matches;
}

// Modified addWord function to handle an array of suggestions
// Make async to get tab URL for default level
async function addSuggestedWords(suggestions) {
    // Get current tab URL to determine default level
    let defaultLevel = 1; // Fallback default
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].url) {
            defaultLevel = getDefaultLevelForSite(tabs[0].url);
            console.log(`[Forcefield AI] Using default level ${defaultLevel} for AI suggestions on this site.`);
        } else {
            console.warn("[Forcefield AI] Could not get active tab URL for default level. Using level 1.");
        }
    } catch (error) {
        console.error("[Forcefield AI] Error getting active tab for default level:", error);
        // Keep defaultLevel = 1 in case of error
    }

    chrome.storage.sync.get(['blockList'], (result) => {
        let blockList = result.blockList || [];
        let addedCount = 0;
        suggestions.forEach(word => {
            const trimmedWord = word.trim();
            if (trimmedWord && !blockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
                 // Add as an object with the determined default level, marked as AI suggested
                blockList.push({ text: trimmedWord, level: defaultLevel, source: 'ai' });
                addedCount++;
                // Log added suggestion to popup console (or could be page console)
                console.log(`[Forcefield AI] Added suggestion: "${trimmedWord}" (level ${defaultLevel})`);
            } else if (trimmedWord) {
                // Log existing suggestion to popup console (or could be page console)
                console.log(`[Forcefield AI] Suggestion "${trimmedWord}" already in list or is empty.`);
            }
        });

        if (addedCount > 0) {
            chrome.storage.sync.set({ blockList }, () => {
                 // Log summary to popup console (or could be page console)
                console.log(`[Forcefield AI] Added ${addedCount} new suggestions to the blocklist.`);
                displayBlockList(blockList); // Update display
                alert(`Added ${addedCount} AI suggestions to the blocklist.`);
            });
        } else {
             // Log summary to popup console (or could be page console)
             console.log('[Forcefield AI] No new suggestions were added to the list.');
             alert('AI analysis complete. No new suggestions were added (they might already exist).');
        }
    });
}

// New function to clear the entire blocklist
function clearAllBlocks() {
    // Optional: Add a confirmation dialog
    if (confirm('Are you sure you want to remove all blocked items?')) {
        chrome.storage.sync.set({ blockList: [] }, () => {
            console.log('Blocklist cleared.');
            displayBlockList([]); // Update display immediately
        });
    }
}

function loadSystemPrompt() {
    chrome.storage.sync.get(['customSystemPrompt'], (result) => {
        const promptToDisplay = result.customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
        systemPromptText.value = promptToDisplay;
    });
}

function saveSystemPrompt() {
    const customPrompt = systemPromptText.value.trim();
    if (customPrompt) {
        chrome.storage.sync.set({ customSystemPrompt: customPrompt }, () => {
            console.log('[Forcefield AI] Custom system prompt saved.');
            alert('System prompt saved!');
        });
    } else {
        // If the user tries to save an empty prompt, reset to default
        resetSystemPrompt(false); // Pass false to avoid double alert if resetSystemPrompt also alerts
        alert('System prompt cannot be empty. Resetting to default.');
    }
}

function resetSystemPrompt(showAlert = true) {
    systemPromptText.value = DEFAULT_SYSTEM_PROMPT;
    chrome.storage.sync.set({ customSystemPrompt: DEFAULT_SYSTEM_PROMPT }, () => {
        console.log('[Forcefield AI] System prompt reset to default.');
        if (showAlert) {
            alert('System prompt reset to default!');
        }
    });
}

function loadUserPromptPrefix() {
    chrome.storage.sync.get(['customUserPromptPrefix'], (result) => {
        const prefixToDisplay = result.customUserPromptPrefix || DEFAULT_USER_PROMPT_PREFIX;
        userPromptPrefixText.value = prefixToDisplay;
    });
}

function saveUserPromptPrefix() {
    const customPrefix = userPromptPrefixText.value; // Allow empty string, but trim for storage consistency if preferred
    // No specific validation here, user can set it as they wish, even empty.
    // If empty, the prompt will just start with pageText.
    chrome.storage.sync.set({ customUserPromptPrefix: customPrefix }, () => {
        console.log('[Forcefield AI] Custom user prompt prefix saved.');
        alert('User prompt prefix saved!');
    });
}

function resetUserPromptPrefix(showAlert = true) {
    userPromptPrefixText.value = DEFAULT_USER_PROMPT_PREFIX;
    chrome.storage.sync.set({ customUserPromptPrefix: DEFAULT_USER_PROMPT_PREFIX }, () => {
        console.log('[Forcefield AI] User prompt prefix reset to default.');
        if (showAlert) {
            alert('User prompt prefix reset to default!');
        }
    });
}

function loadAiModelSelection() {
    // Populate the dropdown
    aiModelSelect.innerHTML = ''; // Clear existing options
    for (const modelId in AVAILABLE_AI_MODELS) {
        const option = document.createElement('option');
        option.value = modelId;
        option.textContent = AVAILABLE_AI_MODELS[modelId];
        aiModelSelect.appendChild(option);
    }

    // Load saved selection or use default
    chrome.storage.sync.get(['selectedAiModel'], (result) => {
        const selectedModel = result.selectedAiModel || DEFAULT_AI_MODEL;
        if (AVAILABLE_AI_MODELS[selectedModel]) {
            aiModelSelect.value = selectedModel;
        } else {
            aiModelSelect.value = DEFAULT_AI_MODEL; // Fallback if saved model is invalid
            console.warn(`[Forcefield AI] Saved model ${selectedModel} not found in available models. Using default.`);
        }
    });
}

function saveAiModelSelection() {
    const selectedModel = aiModelSelect.value;
    if (AVAILABLE_AI_MODELS[selectedModel]) {
        chrome.storage.sync.set({ selectedAiModel: selectedModel }, () => {
            console.log(`[Forcefield AI] AI Model selection saved: ${selectedModel}`);
            // Optional: alert('AI Model selection saved!'); 
        });
    } else {
        console.error(`[Forcefield AI] Attempted to save invalid model: ${selectedModel}`);
    }
}

// Initial load is handled by DOMContentLoaded