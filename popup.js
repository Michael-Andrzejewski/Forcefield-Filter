const wordInput = document.getElementById('wordInput');
const addButton = document.getElementById('addButton');
const blockListDiv = document.getElementById('blockList');
const blockButton = document.getElementById('blockButton');
const aiSuggestButton = document.getElementById('aiSuggestButton');
const clearAllButton = document.getElementById('clearAllButton');

// --- VERY INSECURE - DO NOT USE IN PRODUCTION --- //
// Replace with a secure method (e.g., backend server call)
const ANTHROPIC_API_KEY = 'REDACTED_ANTHROPIC_API_KEY';
// --- END INSECURE SECTION --- //

// Load and display the blocklist when the popup opens
document.addEventListener('DOMContentLoaded', loadBlockList);

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

function addWord() {
  const word = wordInput.value.trim();
  if (word) {
    chrome.storage.sync.get(['blockList'], (result) => {
      const blockList = result.blockList || [];
      // Check if the word (text property) already exists
      if (!blockList.some(item => item.text === word)) {
        // Add as an object with default level 1
        blockList.push({ text: word, level: 1 });
        chrome.storage.sync.set({ blockList }, () => {
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
                    const systemPrompt = `Your task is to identify potentially controversial, politically charged, or negative statements within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger controversial statement.\n\nFocus on extracting specific statements (phrases or sentences) that:\n- Criticize political figures or parties\n- Make controversial claims\n- Contain strong negative opinions or insults\n- Discuss polarizing social or political topics\n- Use inflammatory or charged language\n\nFor each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.\nDo NOT add explanations, apologies, or any text outside the <Negative> tags.\nDo NOT tag entire paragraphs; the tool only works on single statements.\nBe selective and only tag genuinely negative/controversial content, not neutral descriptions or news headlines.\n\nExample Input Text:\n'The new policy announced yesterday is terrible. Many people are upset. Read more on our blog. Meanwhile, the weather is nice.'\n\nExample Correct Output:\n<Negative>The new policy announced yesterday is terrible.</Negative>\n<Negative>Many people are upset.</Negative>`;
                    const userPrompt = `Analyze the following text content and extract potentially controversial, politically charged, or negative statements using <Negative> tags as instructed:\n\n----\n${pageText}\n----\n\nRemember to only return the tagged statements, nothing else.`;

                    const requestBody = {
                        model: "claude-3-5-sonnet-20240620", // Using Sonnet as Haiku might be too limited for complex pages, adjust if needed
                        max_tokens: 4096, // Reduced from 8192 to manage costs/complexity
                        temperature: 0.5, // Lower temperature for more focused output
                        system: systemPrompt,
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
function addSuggestedWords(suggestions) {
    chrome.storage.sync.get(['blockList'], (result) => {
        let blockList = result.blockList || [];
        let addedCount = 0;
        suggestions.forEach(word => {
            const trimmedWord = word.trim();
            if (trimmedWord && !blockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
                 // Add as an object with default level 1, marked as AI suggested
                blockList.push({ text: trimmedWord, level: 1, source: 'ai' });
                addedCount++;
                // Log added suggestion to popup console (or could be page console)
                console.log(`[Forcefield AI] Added suggestion: "${trimmedWord}" (level 1)`);
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

// Initial load is handled by DOMContentLoaded