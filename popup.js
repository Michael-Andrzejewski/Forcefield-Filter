const wordInput = document.getElementById('wordInput');
const addButton = document.getElementById('addButton');
const blockListDiv = document.getElementById('blockList');
const blockButton = document.getElementById('blockButton');
const selectAndBlockButton = document.getElementById('selectAndBlockButton');
const aiSuggestButton = document.getElementById('aiSuggestButton');
const clearAllButton = document.getElementById('clearAllButton');
const systemPromptText = document.getElementById('systemPromptText');
const saveSystemPromptButton = document.getElementById('saveSystemPromptButton');
const resetSystemPromptButton = document.getElementById('resetSystemPromptButton');
const userPromptPrefixText = document.getElementById('userPromptPrefixText');
const saveUserPromptPrefixButton = document.getElementById('saveUserPromptPrefixButton');
const resetUserPromptPrefixButton = document.getElementById('resetUserPromptPrefixButton');
const aiModelSelect = document.getElementById('aiModelSelect');
const startScanningButton = document.getElementById('startScanningButton');
const stopScanningButton = document.getElementById('stopScanningButton');
const scanningStatus = document.getElementById('scanningStatus');
const debugModeCheckbox = document.getElementById('debugModeCheckbox');
const whiteboxModeCheckbox = document.getElementById('whiteboxModeCheckbox');

// --- VERY INSECURE - DO NOT USE IN PRODUCTION --- //
// Kept for the manual "Suggest Blocks (AI)" feature in popup.js
// const ANTHROPIC_API_KEY = 'REDACTED_ANTHROPIC_API_KEY'; // Will be replaced by stored key
// --- END INSECURE SECTION --- //

// Default AI System Prompt (kept for popup.js features)
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

// Default AI User Prompt Prefix (kept for popup.js features)
const DEFAULT_USER_PROMPT_PREFIX = `Analyze the following text content and extract controversial, politically aggressive, non-technical, low-effort, non-insightful, or negative statements using <Negative> tags as instructed:\n\n----\n`;
const DEFAULT_USER_PROMPT_SUFFIX = `\n----\n\nRemember to only return the tagged statements, nothing else.`; // Suffix remains constant for now

// AI Model Configuration (kept for popup.js features)
const AVAILABLE_AI_MODELS = {
    'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet (New)',
    'claude-3-opus-20240229': 'Claude 3 Opus',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
    'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet (Future)'
};
const DEFAULT_AI_MODEL = 'claude-3-5-sonnet-20240620';

// Get new API Key elements
const anthropicApiKeyInput = document.getElementById('anthropicApiKey');
const saveAnthropicApiKeyButton = document.getElementById('saveAnthropicApiKey');

// Load and display the blocklist and system prompt when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    loadBlockList();
    loadSystemPrompt();
    loadUserPromptPrefix();
    loadAiModelSelection();
    loadApiKeys(); // Load API keys
    loadScanningState(); // Load and set initial scanning state
    loadDebugModeState(); // Added
    loadWhiteboxModeState(); // Added for whitebox mode
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
  chrome.storage.local.get(['blockList', 'debugMode'], (result) => {
    const blockList = result.blockList || [];
    const debugMode = result.debugMode || false;
    if (blockList.length === 0) {
        console.log("Blocklist is empty. Nothing to block.");
        return;
    }
    triggerPageBlock(blockList, debugMode);
  });
});

// Add listener for the AI Suggest button
aiSuggestButton.addEventListener('click', getAiSuggestions);

// Add listener for the new Select and Block button
selectAndBlockButton.addEventListener('click', startElementSelection);

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

// Add listeners for API Key buttons
saveAnthropicApiKeyButton.addEventListener('click', () => saveApiKey('anthropicApiKey', anthropicApiKeyInput.value));

// Add listener for Debug Mode checkbox
debugModeCheckbox.addEventListener('change', handleDebugModeChange);

// Add listener for Whitebox Mode checkbox
whiteboxModeCheckbox.addEventListener('change', handleWhiteboxModeChange);

// Add listeners for Scanning buttons
startScanningButton.addEventListener('click', startContinuousScanning);
stopScanningButton.addEventListener('click', stopContinuousScanning);

// Listen for messages from content scripts or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === "scanningStateChanged") {
        updateScanningStatus(request.status);
        sendResponse({status: "Popup status updated"});
    } else if (request.command === "blockListUpdated") {
        console.log('[Forcefield Popup] Received blockListUpdated from background. New suggestions:', request.newSuggestions);
        // Potentially alert the user or just refresh the list display
        loadBlockList(); // Reloads and displays the blocklist
        if (request.newSuggestions && request.newSuggestions.length > 0) {
            // Optional: alert(`Background AI added: ${request.newSuggestions.join(', ')}`);
        }
        sendResponse({status: "Popup blocklist display updated"});
    }
    return true; 
});

function updateScanningStatus(statusText) {
    if (scanningStatus) {
        scanningStatus.textContent = statusText;
    }
    // console.log('[Forcefield Popup] Scanning status update:', statusText);
}

async function loadScanningState() {
    chrome.storage.local.get(['isScanning'], (result) => {
        const isScanningGlobally = result.isScanning || false;

        if (isScanningGlobally) {
            startScanningButton.style.display = 'none';
            stopScanningButton.style.display = 'inline-block';
            updateScanningStatus('Checking scanning state...');

            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!(tabs[0] && tabs[0].id)) {
                    updateScanningStatus("Error: Couldn't get current tab ID.");
                    return;
                }
                const currentTabId = tabs[0].id;

                chrome.runtime.sendMessage({ command: "getActiveScanTabId" }, async (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Forcefield Popup] Error getting activeScanTabId:', chrome.runtime.lastError.message);
                        // Assume we need to start on current tab if background doesn't know
                        updateScanningStatus('Starting scan on current tab (unknown previous)...');
                        startContinuousScanningLogic(currentTabId);
                        chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: currentTabId })
                            .catch(err => console.warn("[Forcefield Popup] Error notifying background (1):", err));
                        return;
                    }

                    const previousActiveScanTabId = response && response.activeScanTabId;

                    if (previousActiveScanTabId === currentTabId) {
                        // Popup opened on the tab that should already be scanning.
                        // Let's verify if the content script's observer is actually running.
                        // console.log(`[Forcefield Popup] Current tab ${currentTabId} is already the active scan tab. Verifying observer state.`);
                        pingContentScriptObserverState(); // This will update status or restart if needed
                    } else {
                        // Scanning needs to be transferred to the current tab.
                        updateScanningStatus(`Transferring scan to current tab ${currentTabId}...`);
                        if (previousActiveScanTabId) {
                            // Stop scanning on the previous tab
                            console.log(`[Forcefield Popup] Sending stopObserving to previous tab ${previousActiveScanTabId}`);
                            chrome.tabs.sendMessage(previousActiveScanTabId, { command: "stopObserving" }, (stopResponse) => {
                                if (chrome.runtime.lastError) {
                                    console.warn(`[Forcefield Popup] Could not stop observer in previous tab ${previousActiveScanTabId}:`, chrome.runtime.lastError.message);
                                } else {
                                    console.log(`[Forcefield Popup] stopObserving response from ${previousActiveScanTabId}:`, stopResponse);
                                }
                            });
                        }
                        
                        // Start scanning on the current tab
                        startContinuousScanningLogic(currentTabId);
                        chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: currentTabId })
                            .catch(err => console.warn("[Forcefield Popup] Error notifying background of scan transfer:", err));
                    }
                });
            });
        } else {
            startScanningButton.style.display = 'inline-block';
            stopScanningButton.style.display = 'none';
            updateScanningStatus('Scanning inactive.');
        }
    });
}

async function pingContentScriptObserverState() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            const tabId = tabs[0].id;
            chrome.tabs.sendMessage(tabId, { command: "queryObserverState" }, (response) => {
                if (chrome.runtime.lastError) {
                    // Content script might not be there, or tab is protected.
                    console.warn(`[Forcefield Popup] pingContentScriptObserverState: Content script unreachable on tab ${tabId}. Attempting to start scanning. Error:`, chrome.runtime.lastError.message);
                    updateScanningStatus('Content script issue. Restarting scan...');
                    startContinuousScanningLogic(tabId); // Attempt to start/inject
                    chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: tabId })
                         .catch(err => console.warn("[Forcefield Popup] Error notifying background (ping issue):", err));
                } else if (response && response.isObserving) {
                    updateScanningStatus('Scanning active on this tab.');
                     // Ensure background knows this is the active tab
                    chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: tabId })
                        .catch(err => console.warn("[Forcefield Popup] Error notifying background (ping success):", err));
                } else {
                    // Observer is not running, but should be.
                    updateScanningStatus('Observer stopped unexpectedly. Restarting scan...');
                    startContinuousScanningLogic(tabId);
                     chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: tabId })
                        .catch(err => console.warn("[Forcefield Popup] Error notifying background (ping restart):", err));
                }
            });
        } else {
            updateScanningStatus("Error: Couldn't get current tab for ping.");
        }
    });
}

function startContinuousScanning() {
    chrome.storage.local.set({ isScanning: true }, () => {
        startScanningButton.style.display = 'none';
        stopScanningButton.style.display = 'inline-block';
        updateScanningStatus('Starting scan...');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                startContinuousScanningLogic(tabs[0].id);
                // Notify background script that scanning has started for this tab
                chrome.runtime.sendMessage({ command: "startContinuousScanBG", tabId: tabs[0].id })
                    .catch(err => console.warn("[Forcefield Popup] Error notifying background of scan start:", err));
            } else {
                console.error("[Forcefield] Could not get active tab ID to start scanning.");
                updateScanningStatus('Error: No active tab found.');
                chrome.storage.local.set({ isScanning: false }); // Revert state
                loadScanningState(); // Refresh UI
            }
        });
    });
}

// Helper function to log messages to the active tab's console from the popup
async function logToActiveTabPageConsole(...args) {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0] && tabs[0].id) {
            const tabId = tabs[0].id;
            const preparedArgs = args.map(arg =>
                (typeof arg === 'object' && arg !== null) ? JSON.stringify(arg, null, 2) : arg
            );
            // Add a prefix to distinguish from other logs, if desired
            const prefixedArgs = ['[Forcefield Popup Tab Log]', ...preparedArgs]; 

            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: (...logs) => { console.log(...logs); },
                args: prefixedArgs,
            });
        } else {
            // Fallback to popup's own console if active tab can't be found
            console.log('[Forcefield Popup Console Fallback]', ...args);
        }
    } catch (error) {
        // Fallback for any other errors
        console.error('[Forcefield Popup Console Fallback] Error logging to page:', error, 'Original args:', ...args);
    }
}

async function startContinuousScanningLogic(tabId) {
    await logToActiveTabPageConsole(`POPUP_LOG: Attempting to start observer for tab ${tabId}. First attempt to send command.`);
    chrome.tabs.sendMessage(tabId, { command: "startObserving" }, async (response) => {
        if (chrome.runtime.lastError) {
            await logToActiveTabPageConsole(`POPUP_LOG: First attempt to send startObserving failed for tab ${tabId}: ${chrome.runtime.lastError.message}. Attempting to inject continuousScan.js.`);
            await logToActiveTabPageConsole(`POPUP_LOG: Entering try block to inject script for tab ${tabId}.`);
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['continuousScan.js']
                });
                await logToActiveTabPageConsole(`POPUP_LOG: continuousScan.js injected or ensured for tab ${tabId}.`);

                await logToActiveTabPageConsole(`POPUP_LOG: Second attempt to send startObserving command for tab ${tabId}.`);
                chrome.tabs.sendMessage(tabId, { command: "startObserving" }, async (responseAfterInjection) => {
                    if (chrome.runtime.lastError) {
                        await logToActiveTabPageConsole(`POPUP_LOG: Error starting observer for tab ${tabId} even after injection: ${chrome.runtime.lastError.message}`);
                        updateScanningStatus(`Error: ${chrome.runtime.lastError.message}. Try reloading tab.`);
                        chrome.storage.local.set({ isScanning: false }, () => {
                            loadScanningState();
                        });
                    } else {
                        await logToActiveTabPageConsole(`POPUP_LOG: Observer start command successfully sent to tab ${tabId} after injection. Response:`, responseAfterInjection);
                    }
                });
            } catch (injectionError) {
                await logToActiveTabPageConsole(`POPUP_LOG: Failed to inject continuousScan.js for tab ${tabId}:`, injectionError);
                updateScanningStatus(`Injection error: ${injectionError.message}. Try reloading tab.`);
                chrome.storage.local.set({ isScanning: false }, () => {
                    loadScanningState();
                });
            }
        } else {
            await logToActiveTabPageConsole(`POPUP_LOG: Observer start command successfully sent to tab ${tabId} on first attempt. Response:`, response);
        }
    });
}

function stopContinuousScanning() {
    chrome.storage.local.set({ isScanning: false }, () => {
        startScanningButton.style.display = 'inline-block';
        stopScanningButton.style.display = 'none';
        updateScanningStatus('Stopping scan...');

        // First, get the active scan tab from background
        chrome.runtime.sendMessage({ command: "getActiveScanTabId" }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('[Forcefield Popup] Error getting active scan tab:', chrome.runtime.lastError.message);
                updateScanningStatus('Error stopping scan');
                return;
            }
            
            const activeScanTabId = response && response.activeScanTabId;
            
            if (activeScanTabId) {
                // Stop the observer in the actively scanning tab
                chrome.tabs.sendMessage(activeScanTabId, { command: "stopObserving" }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Forcefield Popup] Could not stop observer in tab:', activeScanTabId, chrome.runtime.lastError.message);
                        // Continue anyway - the tab might be closed
                    }
                });
                
                // Notify background script
                chrome.runtime.sendMessage({ command: "stopContinuousScanBG", tabId: activeScanTabId })
                    .catch(err => console.warn("[Forcefield Popup] Error notifying background of scan stop:", err));
                
                updateScanningStatus('Scanning stopped.');
            } else {
                console.warn("[Forcefield Popup] No active scan tab found to stop.");
                updateScanningStatus('No active scan to stop.');
            }
        });
    });
}

// Helper to trigger the main blocking script
function triggerPageBlock(blockListToUse, debugMode) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.storage.local.get(['whiteboxMode'], (result) => { // Get whitebox mode state
                const whiteboxMode = result.whiteboxMode || false;
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: injectContentScript,
                    args: [blockListToUse, debugMode, whiteboxMode] // Pass whiteboxMode
                }).catch(err => console.error("[Forcefield] Error injecting/running main block script: ", err));
            });
        } else {
            console.error("[Forcefield] Could not get active tab ID to block content.");
        }
    });
}

function loadBlockList() {
  chrome.storage.local.get(['blockList'], (result) => {
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


    chrome.storage.local.get(['blockList'], (result) => {
      const blockList = result.blockList || [];
      // Check if the word (text property) already exists
      if (!blockList.some(item => item.text.toLowerCase() === word.toLowerCase())) { // Case-insensitive check
        // Add as an object with the determined default level
        // blockList.push({ text: word, level: defaultLevel }); // <-- Reverted: Use fixed level 1
        blockList.push({ text: word, level: 1 });
        chrome.storage.local.set({ blockList }, () => {
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
  chrome.storage.local.get(['blockList'], (result) => {
    const blockList = result.blockList || [];
    const removedItem = blockList.splice(indexToRemove, 1)[0]; // Remove item at index
    chrome.storage.local.set({ blockList }, () => {
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
    chrome.storage.local.get(['blockList'], (result) => {
        const blockList = result.blockList || [];
        if (blockList[index]) {
            blockList[index].level = newLevel;
            chrome.storage.local.set({ blockList }, () => {
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
function injectContentScript(blockListToUse, debugMode, whiteboxMode) {
    // console.log("[Forcefield] Injecting content script with blocklist:", blockListToUse, "Debug Mode:", debugMode);

    const hiddenMarker = 'hiddenByForcefield';
    const debugHighlightClass = 'forcefield-debug-highlight'; // For potential CSS targeting
    const debugHighlightStyle = 'background-color: rgba(255, 0, 0, 0.3) !important; border: 1px solid red !important; display: revert !important; visibility: revert !important;';
    const whiteboxStyle = 'background-color: white !important; border: 1px dashed #ccc !important; visibility: visible !important; overflow: hidden !important;'; // display will be set dynamically

    // First, reset all previously affected elements by this script
    const previouslyAffected = document.querySelectorAll(`[data-${hiddenMarker}]`); // Simplified selector
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
        // Clean up all our custom dataset attributes
        delete el.dataset[hiddenMarker];
        delete el.dataset.originalDisplay;
        delete el.dataset.originalVisibility;
        delete el.dataset.originalBorder;
        delete el.dataset.originalBackgroundColor;
        delete el.dataset.originalWidth;
        delete el.dataset.originalHeight;
        delete el.dataset.originalInnerHTML;

        // Attempt to revert any other inline styles that might have been set for visibility
        // if (el.style.visibility === 'hidden' || el.style.display === 'none') {
        //      el.style.visibility = 'revert';
        //      el.style.display = 'revert';
        // }
    });

    // Helper function to normalize different apostrophe/single quote characters
    function normalizeApostrophes(str) {
        if (!str) return str;
        return str.replace(/[\u2018\u2019\u0060\u00B4]/g, "'"); // Replaces ' ' ` ´ with standard '
    }

    function blockListedContent(blockList) {
        console.log(`[Forcefield] Starting scan for ${blockList.length} words/phrases. Debug: ${debugMode}`);
        const allElements = document.body.getElementsByTagName('*');
        let elementsAffected = 0;
        // const hiddenMarker = 'hiddenByForcefield'; // Already defined above

        // Iterate backwards through all elements
        for (let i = allElements.length - 1; i >= 0; i--) {
            const element = allElements[i];

            // Skip elements that are already hidden by means other than this script if not in debug mode
            // if (!debugMode && element.style.display === 'none' && !element.dataset[hiddenMarker] && !element.classList.contains(debugHighlightClass)) {
            //     continue;
            // }
            // Simpler skip: if it's display: none and we didn't do it, skip. If debug, we might unhide.
            // For whitebox mode, we don't want to skip elements that are display: none, as we might want to "whitebox" them if they contain blocked content.
            // Only skip if it's display: none AND we didn't hide/whitebox it AND it's not debug mode.
            if (element.style.display === 'none' && !element.dataset[hiddenMarker] && !debugMode) {
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
                if (elementToHide && elementToHide !== document.body && elementToHide !== document.documentElement) {

                    // Hide the element and mark it or highlight it
                    if (debugMode) {
                        if (!elementToHide.classList.contains(debugHighlightClass)) {
                            // console.log(`[Forcefield Debug] Highlighting element (level ${actualLevelsAscended} ancestor) for "${matchedBlockItem.text}":`, elementToHide);
                            elementToHide.style.cssText += debugHighlightStyle; // Append to existing styles
                            elementToHide.classList.add(debugHighlightClass);
                            elementToHide.dataset[hiddenMarker] = 'debug'; // Mark as affected by debug
                            elementsAffected++;
                        }
                    } else if (whiteboxMode) {
                        if (elementToHide.dataset[hiddenMarker] !== 'whiteboxed') {
                            // console.log(`[Forcefield Whitebox] Applying whitebox (level ${actualLevelsAscended} ancestor) for "${matchedBlockItem.text}":`, elementToHide);
                            
                            // Save original styles and content
                            elementToHide.dataset.originalDisplay = elementToHide.style.display || '';
                            elementToHide.dataset.originalVisibility = elementToHide.style.visibility || '';
                            elementToHide.dataset.originalBorder = elementToHide.style.border || '';
                            elementToHide.dataset.originalBackgroundColor = elementToHide.style.backgroundColor || '';
                            const computedStyle = window.getComputedStyle(elementToHide);
                            elementToHide.dataset.originalWidth = computedStyle.width;
                            elementToHide.dataset.originalHeight = computedStyle.height;
                            elementToHide.dataset.originalInnerHTML = elementToHide.innerHTML;

                            elementToHide.innerHTML = ''; // Clear content
                            elementToHide.style.cssText += whiteboxStyle; // Apply whitebox styles
                            // Ensure dimensions are preserved
                            elementToHide.style.width = elementToHide.dataset.originalWidth;
                            elementToHide.style.height = elementToHide.dataset.originalHeight;
                            // Ensure it's displayed as a block or inline-block to hold space
                            if (computedStyle.display === 'inline') {
                                elementToHide.style.display = 'inline-block';
                            } else if (computedStyle.display === 'none' || computedStyle.display === '') {
                                // If it was originally display:none, or display not set, default to block.
                                // Content script might have unhidden it.
                                elementToHide.style.display = 'block';
                            } else {
                                elementToHide.style.display = computedStyle.display; // Keep original display type if not inline/none
                            }
                            elementToHide.dataset[hiddenMarker] = 'whiteboxed';
                            elementsAffected++;
                        }
                    } else {
                        if (elementToHide.style.display !== 'none') {
                            // console.log(`[Forcefield] Hiding element (level ${actualLevelsAscended} ancestor) for "${matchedBlockItem.text}":`, elementToHide); // More accurate log
                            elementToHide.style.display = 'none';
                            elementToHide.dataset[hiddenMarker] = 'true'; // Mark as hidden
                            elementsAffected++;
                        }
                    }
                } else if (elementToHide && elementToHide.dataset[hiddenMarker]) { // Check if already marked by us
                    // Element already hidden by us, or highlighted by us, or whiteboxed by us. Do nothing.
                } else if (elementToHide === document.body || elementToHide === document.documentElement) {
                     // Log if we still somehow ended up targeting body/html (e.g., original element was body/html and level was 0)
                     console.warn(`[Forcefield] Avoided affecting BODY/HTML directly for "${matchedBlockItem.text}". Element was likely too high or level too large.`);
                }
            }
        }
        if (elementsAffected > 0) {
            console.log(`[Forcefield] Scan finished. ${debugMode ? 'Highlighted' : 'Hid'} ${elementsAffected} elements/ancestors.`);
        } else {
            console.log(`[Forcefield] Scan finished. No new elements ${debugMode ? 'highlighted' : 'hidden'}.`);
        }
    }

    // Run the blocking logic
    blockListedContent(blockListToUse);
}

// --- New API Key Management Functions ---
function loadApiKeys() {
    chrome.storage.sync.get(['anthropicApiKey'], (result) => {
        if (result.anthropicApiKey) {
            anthropicApiKeyInput.value = result.anthropicApiKey;
        }
        console.log('[Forcefield Popup] API Keys loaded.');
    });
}

function saveApiKey(keyName, keyValue) {
    if (keyValue && keyValue.trim() !== "") {
        chrome.storage.sync.set({ [keyName]: keyValue.trim() }, () => {
            console.log(`[Forcefield Popup] ${keyName} saved.`);
            alert(`${keyName.replace('ApiKey', ' API Key')} saved!`);
        });
    } else {
        // Optionally clear the key if the input is empty
        chrome.storage.sync.remove(keyName, () => {
            console.log(`[Forcefield Popup] ${keyName} cleared.`);
            alert(`${keyName.replace('ApiKey', ' API Key')} cleared.`);
        });
    }
}
// --- End API Key Management Functions ---

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

                    // Get the Anthropic API Key from storage
                    const storedKeys = await new Promise((resolve) => {
                        chrome.storage.sync.get(['anthropicApiKey'], resolve);
                    });
                    const anthropicApiKey = storedKeys.anthropicApiKey;

                    if (!anthropicApiKey) {
                        alert('Anthropic API Key is not set. Please set it in the settings.');
                        aiSuggestButton.textContent = 'Suggest Blocks (AI)';
                        aiSuggestButton.disabled = false;
                        return;
                    }

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
                            'x-api-key': anthropicApiKey, // Use the stored key
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
async function addSuggestedWords(suggestions, defaultLevelOverride = null, source = 'ai_manual') {
    let defaultLevelToUse = 1; 
    if (defaultLevelOverride !== null) {
        defaultLevelToUse = defaultLevelOverride;
    } else {
        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs[0] && tabs[0].url) {
                defaultLevelToUse = getDefaultLevelForSite(tabs[0].url);
            }
        } catch (error) {
            console.error(`[Forcefield AI - ${source}] Error getting active tab for default level:`, error);
        }
    }

    chrome.storage.local.get(['blockList'], (result) => {
        let blockList = result.blockList || [];
        let addedCount = 0;
        suggestions.forEach(word => {
            const trimmedWord = word.trim();
            if (trimmedWord && !blockList.some(item => item.text.toLowerCase() === trimmedWord.toLowerCase())) {
                blockList.push({ text: trimmedWord, level: defaultLevelToUse, source: source });
                addedCount++;
                console.log(`[Forcefield AI - ${source}] Added suggestion: "${trimmedWord}" (level ${defaultLevelToUse})`);
            } else if (trimmedWord) {
                console.log(`[Forcefield AI - ${source}] Suggestion "${trimmedWord}" already in list or is empty.`);
            }
        });

        if (addedCount > 0) {
            chrome.storage.local.set({ blockList }, () => {
                console.log(`[Forcefield AI - ${source}] Added ${addedCount} new suggestions to the blocklist.`);
                displayBlockList(blockList);
                if (source !== 'ai_continuous') {
                    alert(`Added ${addedCount} AI suggestions to the blocklist.`);
                }
            });
        } else {
             console.log(`[Forcefield AI - ${source}] No new suggestions were added to the list.`);
             if (source !== 'ai_continuous') {
                alert('AI analysis complete. No new suggestions were added (they might already exist).');
            }
        }
    });
}

// New function to clear the entire blocklist
function clearAllBlocks() {
    if (confirm('Are you sure you want to remove all blocked items?')) {
        chrome.storage.local.set({ blockList: [] }, () => {
            console.log('Blocklist cleared.');
            displayBlockList([]);
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

// New function to load debug mode state
function loadDebugModeState() {
    chrome.storage.local.get(['debugMode'], (result) => {
        debugModeCheckbox.checked = result.debugMode || false;
    });
}

// New function to save debug mode state and re-trigger blocking
function handleDebugModeChange() {
    const isDebugMode = debugModeCheckbox.checked;
    chrome.storage.local.set({ debugMode: isDebugMode }, () => {
        console.log(`[Forcefield] Debug mode set to: ${isDebugMode}`);
        if (isDebugMode && whiteboxModeCheckbox.checked) {
            whiteboxModeCheckbox.checked = false; // Turn off whitebox if debug is turned on
            handleWhiteboxModeChange(false); // Update storage for whitebox
        }
        // Re-trigger blocking on the current page to apply the new mode
        chrome.storage.local.get(['blockList'], (result) => {
            const blockList = result.blockList || [];
            triggerPageBlock(blockList, isDebugMode);
        });
    });
}

// New function to load whitebox mode state
function loadWhiteboxModeState() {
    chrome.storage.local.get(['whiteboxMode'], (result) => {
        whiteboxModeCheckbox.checked = result.whiteboxMode || false;
    });
}

// New function to save whitebox mode state and re-trigger blocking
function handleWhiteboxModeChange(triggerBlock = true) {
    const isWhiteboxMode = whiteboxModeCheckbox.checked;
    chrome.storage.local.set({ whiteboxMode: isWhiteboxMode }, () => {
        console.log(`[Forcefield] Whitebox mode set to: ${isWhiteboxMode}`);
        if (isWhiteboxMode && debugModeCheckbox.checked) {
            debugModeCheckbox.checked = false; // Turn off debug if whitebox is turned on
            handleDebugModeChange(); // This will re-trigger page block
            return; // Avoid double trigger
        }
        if (triggerBlock) {
            chrome.storage.local.get(['blockList', 'debugMode'], (result) => {
                const blockList = result.blockList || [];
                const debugMode = result.debugMode || false; // Get current debug mode
                triggerPageBlock(blockList, debugMode); // Pass debugMode here
            });
        }
    });
}

function startElementSelection() {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0] && tabs[0].id) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    files: ['elementSelector.js']
                });
                // Close the popup so the user can interact with the page
                window.close();
            } catch (err) {
                console.error("[Forcefield] Failed to start element selection:", err);
                alert("Could not start element selection mode. You may need to reload the page. Check the console for more details.");
            }
        } else {
            alert("Could not find an active tab to start element selection.");
        }
    });
}

// Initial load is handled by DOMContentLoaded