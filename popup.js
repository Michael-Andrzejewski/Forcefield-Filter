// UI Mode Elements
const developerModeToggle = document.getElementById('developerModeToggle');
const simpleMode = document.getElementById('simpleMode');
const developerMode = document.getElementById('developerMode');

// Simple Mode Elements
const mainScanningButton = document.getElementById('mainScanningButton');
const scanningButtonText = document.getElementById('scanningButtonText');
const scanningStatus = document.getElementById('scanningStatus');

// Developer Mode Elements
const devScanningButton = document.getElementById('devScanningButton');
const devScanningButtonText = document.getElementById('devScanningButtonText');
const devScanningStatus = document.getElementById('devScanningStatus');

// Common Elements (exist in both modes)
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
const devAiModelSelect = document.getElementById('devAiModelSelect');
const debugModeCheckbox = document.getElementById('debugModeCheckbox');
const whiteboxModeCheckbox = document.getElementById('whiteboxModeCheckbox');

// Site Management Elements
const siteInput = document.getElementById('siteInput');
const addSiteButton = document.getElementById('addSiteButton');
const allowedSitesListDiv = document.getElementById('allowedSitesList');
const devSiteInput = document.getElementById('devSiteInput');
const devAddSiteButton = document.getElementById('devAddSiteButton');
const devAllowedSitesListDiv = document.getElementById('devAllowedSitesList');


// AI Model Configuration (AVAILABLE_AI_MODELS, DEFAULT_AI_MODEL) now comes from llm.js,
// loaded before popup.js in popup.html.

// Get new API Key elements
const anthropicApiKeyInput = document.getElementById('anthropicApiKey');
const saveAnthropicApiKeyButton = document.getElementById('saveAnthropicApiKey');
const geminiApiKeyInput = document.getElementById('geminiApiKey');
const saveGeminiApiKeyButton = document.getElementById('saveGeminiApiKey');

// Load and display the blocklist and system prompt when the popup opens
document.addEventListener('DOMContentLoaded', () => {
    loadDeveloperMode(); // Load developer mode state first
    loadBlockList();
    loadSystemPrompt();
    loadUserPromptPrefix();
    loadAiModelSelection();
    loadApiKeys(); // Load API keys
    loadAllowedSites(); // Load the list of allowed sites
    loadScanningState(); // Load and set initial scanning state
    loadDebugModeState(); // Added
    loadWhiteboxModeState(); // Added for whitebox mode
    setupCollapsibleSections(); // Setup collapsible sections
    renderTwitterActivity(); // Twitter like/mute/block/not-interested log
    loadSpendInfo(); // AI spend counters + budget limit inputs
    loadAutonomousUI(); // Autonomous curation: nightly toggle + last-run summary
});

// --- Autonomous curation (Run Now button, last-run summary) ---
const runAutonomousButton = document.getElementById('runAutonomousButton');
const stopAutonomousButton = document.getElementById('stopAutonomousButton');

// Nightly-at-midnight config lives in Developer mode's Debug Settings and is
// OFF by default: unattended automated sessions have triggered X's human
// verification challenges. The background reschedules on change.
const nightlyAutonomousCheckbox = document.getElementById('nightlyAutonomousCheckbox');
if (nightlyAutonomousCheckbox) {
    chrome.storage.sync.get(['nightlyAutonomousEnabled'], (res) => {
        nightlyAutonomousCheckbox.checked = !!res.nightlyAutonomousEnabled;
    });
    nightlyAutonomousCheckbox.addEventListener('change', () => {
        chrome.storage.sync.set({ nightlyAutonomousEnabled: nightlyAutonomousCheckbox.checked }, () => {
            console.log(`[Forcefield Popup] Nightly autonomous mode ${nightlyAutonomousCheckbox.checked ? 'enabled' : 'disabled'}.`);
        });
    });
}

function renderAutonomousLastRun(summary) {
    const el = document.getElementById('autonomousLastRun');
    if (!el) return;
    if (!summary) {
        el.textContent = 'No autonomous runs yet.';
        return;
    }
    const when = new Date(summary.when).toLocaleString();
    let text = `Last run ${when}: muted ${summary.muted.length}, not-interested ${summary.notInterested.length}, scanned ${summary.scanned} posts (${summary.reason}).`;
    const names = summary.muted.map(m => m.handle).filter(Boolean);
    if (names.length) text += `\nMuted: ${names.join(', ')}`;
    el.textContent = text;
}

function loadAutonomousUI() {
    chrome.storage.local.get(['lastAutonomousRun'], (res) => {
        renderAutonomousLastRun(res.lastAutonomousRun);
    });
}

if (runAutonomousButton) {
    runAutonomousButton.addEventListener('click', () => {
        runAutonomousButton.textContent = 'Starting...';
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0] ? tabs[0].id : null;
            // The background finds/opens the x.com tab and injects the agent;
            // the popup closes itself when that tab takes focus.
            chrome.runtime.sendMessage({ command: 'autonomousRunNow', tabId: tabId }, (resp) => {
                if (resp && resp.error) {
                    runAutonomousButton.textContent = 'Run Now & Watch';
                    alert('Could not start: ' + resp.error);
                } else {
                    window.close();
                }
            });
        });
    });
}

if (stopAutonomousButton) {
    stopAutonomousButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ command: 'autonomousStopAll' }, () => {
            stopAutonomousButton.textContent = 'Stop Sent';
            setTimeout(() => { stopAutonomousButton.textContent = 'Stop Session'; }, 1500);
        });
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.lastAutonomousRun) {
        renderAutonomousLastRun(changes.lastAutonomousRun.newValue);
    }
});

// --- AI Budget (spend counters + limits) ---
// getSpendState / getSpendLimits / DEFAULT_SPEND_LIMITS come from llm.js.
async function loadSpendInfo() {
    try {
        const [{ hourSpend, daySpend }, limits] = await Promise.all([getSpendState(), getSpendLimits()]);
        const summary = `AI spend: $${hourSpend.toFixed(2)}/$${limits.hourly.toFixed(2)} this hour · $${daySpend.toFixed(2)}/$${limits.daily.toFixed(2)} today`;
        ['spendDisplay', 'devSpendDisplay'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = summary;
        });
        const detail = document.getElementById('budgetSpendDetail');
        if (detail) detail.textContent = summary + '. Calls pause when a limit is hit and resume as spend ages out.';

        const hourlyInput = document.getElementById('hourlyLimitInput');
        const dailyInput = document.getElementById('dailyLimitInput');
        // Don't clobber a value the user is mid-typing.
        if (hourlyInput && document.activeElement !== hourlyInput) hourlyInput.value = limits.hourly;
        if (dailyInput && document.activeElement !== dailyInput) dailyInput.value = limits.daily;
    } catch (e) {
        console.warn('[Forcefield Popup] Could not load spend info:', e);
    }
}

const saveSpendLimitsButton = document.getElementById('saveSpendLimitsButton');
if (saveSpendLimitsButton) {
    saveSpendLimitsButton.addEventListener('click', () => {
        const hourly = parseFloat(document.getElementById('hourlyLimitInput').value);
        const daily = parseFloat(document.getElementById('dailyLimitInput').value);
        if (isNaN(hourly) || isNaN(daily) || hourly <= 0 || daily <= 0) {
            alert('Limits must be positive dollar amounts.');
            return;
        }
        if (daily < hourly) {
            alert('The daily limit should be at least the hourly limit.');
            return;
        }
        chrome.storage.sync.set({ spendLimits: { hourly: hourly, daily: daily } }, () => {
            console.log(`[Forcefield Popup] Spend limits saved: $${hourly}/hr, $${daily}/day.`);
            loadSpendInfo();
            alert(`Budget saved: $${hourly.toFixed(2)}/hour, $${daily.toFixed(2)}/day.`);
        });
    });
}

// Add word to blocklist
addButton.addEventListener('click', addWord);
wordInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addWord();
  }
});

// Add listener for Developer Mode toggle
developerModeToggle.addEventListener('click', toggleDeveloperMode);

// Add listeners for new Allowed Sites functionality (both simple and dev mode)
addSiteButton.addEventListener('click', () => addSite(false));
siteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addSite(false);
    }
});

devAddSiteButton.addEventListener('click', () => addSite(true));
devSiteInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        addSite(true);
    }
});

// Add listeners for scanning buttons
mainScanningButton.addEventListener('click', toggleScanning);
devScanningButton.addEventListener('click', toggleScanning);

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

// Add listener for AI Model selection change (both simple and dev mode)
aiModelSelect.addEventListener('change', saveAiModelSelection);
devAiModelSelect.addEventListener('change', saveAiModelSelection);

// Add listeners for API Key buttons
saveAnthropicApiKeyButton.addEventListener('click', () => saveApiKey('anthropicApiKey', anthropicApiKeyInput.value));
if (saveGeminiApiKeyButton) {
    saveGeminiApiKeyButton.addEventListener('click', () => saveApiKey('geminiApiKey', geminiApiKeyInput.value));
}

// --- Twitter Activity Log ---
const copyTwitterLogButton = document.getElementById('copyTwitterLogButton');
const clearTwitterLogButton = document.getElementById('clearTwitterLogButton');
const EMPTY_TWITTER_ACTIVITY = { liked: [], notInterested: [], muted: [], blocked: [] };

function formatTwitterActivity(store) {
    const cats = [
        ['liked', 'LIKED'],
        ['notInterested', 'NOT INTERESTED'],
        ['muted', 'MUTED'],
        ['blocked', 'BLOCKED']
    ];
    const out = [];
    cats.forEach(([key, label]) => {
        const list = (store && store[key]) || [];
        out.push(`=== ${label} (${list.length}) ===`);
        if (!list.length) {
            out.push('(none)');
        } else {
            list.forEach(e => {
                const who = e.handle || e.displayName || '(unknown)';
                const text = (e.text || '').replace(/\s+/g, ' ').trim();
                out.push(text ? `${who}: ${text}` : who);
            });
        }
        out.push('');
    });
    return out.join('\n').trim();
}

function renderTwitterActivity() {
    const pre = document.getElementById('twitterActivityLog');
    if (!pre) return;
    chrome.storage.local.get(['twitterActivity'], (res) => {
        pre.textContent = formatTwitterActivity(res.twitterActivity) || '(no activity logged yet)';
    });
}

if (copyTwitterLogButton) {
    copyTwitterLogButton.addEventListener('click', () => {
        const pre = document.getElementById('twitterActivityLog');
        if (pre && navigator.clipboard) {
            navigator.clipboard.writeText(pre.textContent).then(() => {
                copyTwitterLogButton.textContent = 'Copied!';
                setTimeout(() => { copyTwitterLogButton.textContent = 'Copy'; }, 1200);
            });
        }
    });
}

if (clearTwitterLogButton) {
    clearTwitterLogButton.addEventListener('click', () => {
        if (confirm('Clear the Twitter activity log? This cannot be undone.')) {
            chrome.storage.local.set({ twitterActivity: EMPTY_TWITTER_ACTIVITY }, renderTwitterActivity);
        }
    });
}

// Live-update the log and spend counters while the popup is open.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.twitterActivity) {
        renderTwitterActivity();
    }
    if (area === 'local' && changes.aiSpendLog) {
        loadSpendInfo();
    }
});

// Add listener for Debug Mode checkbox
debugModeCheckbox.addEventListener('change', handleDebugModeChange);

// Add listener for Whitebox Mode checkbox
whiteboxModeCheckbox.addEventListener('change', handleWhiteboxModeChange);

// Note: Scanning button listeners are now handled by toggleScanning function

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

// --- New functions for Allowed Sites ---

function loadAllowedSites() {
    chrome.storage.sync.get(['allowedSites'], (result) => {
        const sites = result.allowedSites || ['twitter.com', 'x.com', 'quora.com']; // Default sites
        // If it's the first time, set the default list in storage
        if (!result.allowedSites) {
            chrome.storage.sync.set({ allowedSites: sites });
        }
        displayAllowedSites(sites);
    });
}

function displayAllowedSites(sites) {
    // Update both simple mode and developer mode lists
    [allowedSitesListDiv, devAllowedSitesListDiv].forEach(listDiv => {
        if (listDiv) {
            listDiv.innerHTML = '';
            sites.forEach((site, index) => {
                const tag = document.createElement('span');
                tag.className = listDiv === allowedSitesListDiv ? 'site-tag' : 'site-tag';

                const text = document.createElement('span');
                text.textContent = site;
                tag.appendChild(text);

                const removeButton = document.createElement('button');
                removeButton.textContent = '×';
                removeButton.className = 'site-remove';
                removeButton.title = 'Remove Site';
                removeButton.addEventListener('click', () => removeSite(index));
                tag.appendChild(removeButton);

                listDiv.appendChild(tag);
            });
        }
    });
}


function removeSite(indexToRemove) {
    chrome.storage.sync.get(['allowedSites'], (result) => {
        let sites = result.allowedSites || [];
        const removedSite = sites.splice(indexToRemove, 1)[0];
        chrome.storage.sync.set({ allowedSites: sites }, () => {
            console.log(`[Forcefield] Removed "${removedSite}" from allowed sites.`);
            displayAllowedSites(sites);
            // After removing a site, we should re-evaluate the scanning state
            loadScanningState();
        });
    });
}

// --- End new functions for Allowed Sites ---

function updateScanningStatus(statusText) {
    // Update both simple and developer mode status elements
    if (scanningStatus) {
        scanningStatus.textContent = statusText;
    }
    if (devScanningStatus) {
        devScanningStatus.textContent = statusText;
    }
    // console.log('[Forcefield Popup] Scanning status update:', statusText);
}

function updateScanningButtons(isActive, isDisabled = false) {
    // Update both simple and developer mode scanning buttons
    const buttons = [
        { button: mainScanningButton, text: scanningButtonText },
        { button: devScanningButton, text: devScanningButtonText }
    ];
    
    buttons.forEach(({ button, text }) => {
        if (button && text) {
            if (isActive) {
                button.classList.remove('inactive');
                button.classList.add('active');
                text.textContent = 'Stop Scanning/Hiding';
            } else {
                button.classList.remove('active');
                button.classList.add('inactive');
                text.textContent = 'Start Scanning/Hiding';
            }
            button.disabled = isDisabled;
        }
    });
}

async function loadScanningState() {
    chrome.storage.local.get(['isScanning'], async (result) => {
        const isScanningGlobally = result.isScanning || false;

        // Check if the current tab is an allowed site
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const currentTab = tabs[0];
        const isAllowedSite = await checkIsOnAllowedSite(currentTab);

        if (!isAllowedSite) {
            updateScanningButtons(false, true); // Set inactive and disabled
            updateScanningStatus('Site not on allowed list.');
            return; // Stop further processing
        }
        
        // Site is allowed, proceed with normal logic.
        // Reflect the GLOBAL scanning state on the toggle immediately, so the
        // button shows green "Stop Scanning" when a scan is already running
        // (instead of staying gray "Start Scanning" while the status says active).
        updateScanningButtons(isScanningGlobally, false);

        if (isScanningGlobally) {
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
            updateScanningButtons(false, false); // Set inactive but enabled
            updateScanningStatus('Scanning inactive.');
        }
    });
}

// Helper function to check if the current tab's URL is in the allowed list
async function checkIsOnAllowedSite(tab) {
    if (!tab || !tab.url) return false;

    return new Promise((resolve) => {
        chrome.storage.sync.get(['allowedSites'], (result) => {
            const sites = result.allowedSites || [];
            if (sites.length === 0) {
                resolve(true); // If list is empty, allow all sites
                return;
            }
            try {
                const tabHostname = new URL(tab.url).hostname;
                // Exact host or subdomain only — a bare endsWith('x.com') would match netflix.com.
                const match = sites.some(site => tabHostname === site || tabHostname.endsWith('.' + site));
                resolve(match);
            } catch (e) {
                console.warn("[Forcefield] Could not parse current tab URL:", tab.url, e);
                resolve(false);
            }
        });
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
        updateScanningButtons(true, false);
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
        updateScanningButtons(false, false);
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

// Helper to trigger the main blocking script. Delegates to the background service
// worker so there is exactly ONE matcher implementation (background.js:
// actualContentBlockingFunction) — the popup used to carry its own stale copy.
// The background reads blockList/debugMode/whiteboxMode from storage itself, so
// the parameters are accepted only for caller compatibility.
function triggerPageBlock(blockListToUse, debugMode) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) {
            chrome.runtime.sendMessage({ command: "runBlocker", tabId: tabs[0].id })
                .catch(err => console.error("[Forcefield] Error asking background to run blocker:", err));
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
    text.className = 'tag-text';
    text.textContent = item.text; // Use item.text
    tag.appendChild(text);

    // Create number input for level
    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.className = 'tag-level';
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

    // Add a "Refine AI" button if the item was added by AI
    if (item.source && (item.source === 'ai_manual' || item.source === 'ai_continuous')) {
        const refineButton = document.createElement('button');
        refineButton.textContent = 'AI'; // Changed to 'AI' for better visibility
        refineButton.className = 'tag-remove'; // Use same styling as remove
        refineButton.title = 'Refine AI: Mark as incorrect and remove';
        refineButton.addEventListener('click', () => refineAndRemove(index, item.text));
        tag.appendChild(refineButton);
    }

    const removeButton = document.createElement('button');
    removeButton.textContent = '×';
    removeButton.className = 'tag-remove';
    removeButton.title = 'Remove'; // Add tooltip
    removeButton.addEventListener('click', () => removeWord(index));
    tag.appendChild(removeButton);

    blockListDiv.appendChild(tag);
  });
}

// Function to handle refining the AI and removing the item
function refineAndRemove(indexToRemove, textToRefine) {
    if (confirm(`Are you sure you want to mark "${textToRefine}" as an incorrect block and ask the AI to learn from this?`)) {
        // 1. Send the text to the background script for refinement
        console.log(`[Forcefield Popup] Sending "${textToRefine}" for AI prompt refinement.`);
        chrome.runtime.sendMessage({
            command: "refineSystemPrompt",
            text: textToRefine
        }).catch(err => console.error('[Forcefield Popup] Error sending refinement message:', err));

        // 2. Remove the word from the blocklist locally
        removeWord(indexToRemove);
    }
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


// --- New API Key Management Functions ---
function loadApiKeys() {
    chrome.storage.sync.get(['anthropicApiKey', 'geminiApiKey'], (result) => {
        if (result.anthropicApiKey && anthropicApiKeyInput) {
            anthropicApiKeyInput.value = result.anthropicApiKey;
        }
        if (result.geminiApiKey && geminiApiKeyInput) {
            geminiApiKeyInput.value = result.geminiApiKey;
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

                    // Get both provider API keys from storage
                    const storedKeys = await new Promise((resolve) => {
                        chrome.storage.sync.get(['anthropicApiKey', 'geminiApiKey'], resolve);
                    });
                    const provider = providerForModel(currentAiModel);
                    const keyForProvider = provider === 'google' ? storedKeys.geminiApiKey : storedKeys.anthropicApiKey;

                    if (!keyForProvider) {
                        alert(`${provider === 'google' ? 'Gemini' : 'Anthropic'} API Key is not set. Please set it in the settings.`);
                        aiSuggestButton.textContent = 'Suggest Blocks (AI)';
                        aiSuggestButton.disabled = false;
                        return;
                    }

                    // Prepare the prompt
                    const userPrompt = `${currentUserPromptPrefix}${pageText}${DEFAULT_USER_PROMPT_SUFFIX}`;
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Sending request via', provider, 'model', currentAiModel);

                    // --- API Call (via provider abstraction in llm.js) --- //
                    // WARNING: API Key is exposed client-side. See security note above.
                    let aiResponseContent = '';
                    aiResponseContent = await callLLM({
                        model: currentAiModel,
                        system: currentSystemPrompt,
                        userText: userPrompt,
                        maxTokens: 4096,
                        anthropicApiKey: storedKeys.anthropicApiKey,
                        geminiApiKey: storedKeys.geminiApiKey,
                        cacheSystem: true
                    });
                    await logToPageConsole(tabs[0].id, '[Forcefield AI] Received response.');

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
                // Apply the updated list immediately so the user sees the effect
                // without having to click "Block Listed Content" afterwards.
                triggerPageBlock(blockList, false);
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
    // Populate both dropdowns
    [aiModelSelect, devAiModelSelect].forEach(select => {
        if (select) {
            select.innerHTML = ''; // Clear existing options
            for (const modelId in AVAILABLE_AI_MODELS) {
                const option = document.createElement('option');
                option.value = modelId;
                option.textContent = AVAILABLE_AI_MODELS[modelId];
                select.appendChild(option);
            }
        }
    });

    // Load saved selection or use default
    chrome.storage.sync.get(['selectedAiModel'], (result) => {
        let selectedModel = result.selectedAiModel || DEFAULT_AI_MODEL;
        if (!AVAILABLE_AI_MODELS[selectedModel]) {
            console.warn(`[Forcefield AI] Saved model ${selectedModel} is unavailable. Resetting to ${DEFAULT_AI_MODEL}.`);
            selectedModel = DEFAULT_AI_MODEL;
            chrome.storage.sync.set({ selectedAiModel: DEFAULT_AI_MODEL }); // clean stale value
        }
        [aiModelSelect, devAiModelSelect].forEach(select => {
            if (select) select.value = selectedModel;
        });
    });
}

function saveAiModelSelection(event) {
    const selectedModel = event.target.value;
    if (AVAILABLE_AI_MODELS[selectedModel]) {
        chrome.storage.sync.set({ selectedAiModel: selectedModel }, () => {
            console.log(`[Forcefield AI] AI Model selection saved: ${selectedModel}`);
            // Sync both dropdowns
            [aiModelSelect, devAiModelSelect].forEach(select => {
                if (select && select !== event.target) {
                    select.value = selectedModel;
                }
            });
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

// Developer Mode Management
function loadDeveloperMode() {
    chrome.storage.local.get(['developerMode'], (result) => {
        const isDeveloperMode = result.developerMode || false;
        setDeveloperMode(isDeveloperMode);
    });
}

function toggleDeveloperMode() {
    chrome.storage.local.get(['developerMode'], (result) => {
        const currentMode = result.developerMode || false;
        const newMode = !currentMode;
        chrome.storage.local.set({ developerMode: newMode }, () => {
            setDeveloperMode(newMode);
        });
    });
}

function setDeveloperMode(isDeveloperMode) {
    if (isDeveloperMode) {
        simpleMode.classList.add('hidden');
        developerMode.classList.remove('hidden');
        developerModeToggle.classList.add('active');
    } else {
        simpleMode.classList.remove('hidden');
        developerMode.classList.add('hidden');
        developerModeToggle.classList.remove('active');
    }
}

// Collapsible Sections Management
function setupCollapsibleSections() {
    const devSections = document.querySelectorAll('.dev-section');
    devSections.forEach(section => {
        const header = section.querySelector('.dev-section-header');
        if (header) {
            header.addEventListener('click', () => {
                section.classList.toggle('collapsed');
            });
        }
    });
}

// Unified Scanning Toggle
function toggleScanning() {
    chrome.storage.local.get(['isScanning'], (result) => {
        const isCurrentlyScanning = result.isScanning || false;
        if (isCurrentlyScanning) {
            stopContinuousScanning();
        } else {
            startContinuousScanning();
        }
    });
}


// Update Site Management to Work with Both Modes
function addSite(isDeveloperMode = false) {
    const input = isDeveloperMode ? devSiteInput : siteInput;
    const newSite = input.value.trim().toLowerCase();
    if (newSite) {
        // A simple validation to remove "http://", "https://", "www." prefixes
        const formattedSite = newSite.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

        if (!formattedSite) {
            input.value = '';
            return;
        }

        chrome.storage.sync.get(['allowedSites'], (result) => {
            let sites = result.allowedSites || [];
            if (!sites.includes(formattedSite)) {
                sites.push(formattedSite);
                chrome.storage.sync.set({ allowedSites: sites }, () => {
                    console.log(`[Forcefield] Added "${formattedSite}" to allowed sites.`);
                    displayAllowedSites(sites);
                    input.value = '';
                    // After adding a site, we should re-evaluate the scanning state
                    loadScanningState();
                });
            } else {
                console.log(`[Forcefield] Site "${formattedSite}" is already in the allowed list.`);
                input.value = '';
            }
        });
    }
}