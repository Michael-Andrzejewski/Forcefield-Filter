// Ensure the script only initializes once per page context
if (typeof window.forcefieldObserverInitialized === 'undefined') {
    window.forcefieldObserverInitialized = true;

    let observer = null;
    let debounceTimer = null;
    let newTextBuffer = []; // Collects text from mutations
    let isObserving = false; // This will be controlled by messages
    const DEBOUNCE_DELAY = 100; // 1 second
    const MIN_NODE_TEXT_LENGTH = 5; // Minimum length for a single node's text to be considered
    const MIN_COMBINED_TEXT_LENGTH = 50; // Minimum length for the combined text to be sent to AI
    const MIN_ALPHA_RATIO = 0.7; // Minimum ratio of alphabetic characters in the text

    function canSendMessage() {
        return chrome.runtime && chrome.runtime.sendMessage;
    }

    // Helper function to check if text has a minimum ratio of alphabetic characters
    function hasSufficientAlphaCharacters(text, minRatio) {
        if (!text || text.length === 0) return false;
        const alphaChars = text.match(/[a-zA-Z]/g);
        if (!alphaChars) return false;
        return (alphaChars.length / text.length) >= minRatio;
    }

    function performInitialScan() {
        if (!document.body) {
            console.warn('[Forcefield CS] Initial scan aborted: document.body not available.');
            return;
        }
        console.log('[Forcefield CS] Performing initial page scan...');
        const initialScanBuffer = [];

        function collectVisibleTextRecursive(node, buffer) {
            // 1. Skip if node itself is undesirable
            if (!node) return;
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.dataset.hiddenByForcefield ||
                    node.tagName === 'SCRIPT' ||
                    node.tagName === 'STYLE' ||
                    node.tagName === 'NOSCRIPT' ||
                    node.tagName === 'IFRAME'   ||
                    node.tagName === 'TEXTAREA' ||
                    node.tagName === 'CANVAS'
                    ) {
                    return; // Skip this node and its children
                }
                // Optional: More robust check for elements that are effectively hidden
                // const style = window.getComputedStyle(node);
                // if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                //     return;
                // }
            }

            // 2. Process TEXT_NODE
            if (node.nodeType === Node.TEXT_NODE) {
                const textContent = node.nodeValue || '';
                const trimmedText = textContent.trim();
                if (trimmedText.length >= MIN_NODE_TEXT_LENGTH && hasSufficientAlphaCharacters(trimmedText, MIN_ALPHA_RATIO)) {
                    buffer.push(trimmedText);
                }
            }
            // 3. Recurse for ELEMENT_NODE children
            else if (node.nodeType === Node.ELEMENT_NODE) {
                // Iterate over a copy of childNodes if the collection might change during iteration elsewhere (not an issue here)
                for (let i = 0; i < node.childNodes.length; i++) {
                    collectVisibleTextRecursive(node.childNodes[i], buffer);
                }
            }
        }

        collectVisibleTextRecursive(document.body, initialScanBuffer);

        if (initialScanBuffer.length > 0) {
            const combinedText = initialScanBuffer.join('\n\n').trim();
            if (combinedText.length >= MIN_COMBINED_TEXT_LENGTH && hasSufficientAlphaCharacters(combinedText, MIN_ALPHA_RATIO)) {
                console.log('[Forcefield Continuous Scan] Initial page scan text meeting criteria:', combinedText.substring(0, 200) + '...');
                if (canSendMessage()) {
                    chrome.runtime.sendMessage({ command: "newContentDetected", text: combinedText }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[Forcefield CS] Error sending newContentDetected (initial scan):', chrome.runtime.lastError.message);
                        }
                    });
                } else {
                    console.warn('[Forcefield CS] Context invalidated, cannot send newContentDetected (initial scan).');
                }
            } else {
                console.log('[Forcefield Continuous Scan] Initial scan text too short, numeric, or insignificant, skipping AI call. Length:', combinedText.length, 'Text:', combinedText.substring(0,100) + '...');
            }
        } else {
            console.log('[Forcefield Continuous Scan] Initial scan found no significant text to process.');
        }
    }

    function handleMutations(mutationsList, obs) {
        if (!isObserving) return; // Check against the script-local isObserving

        let significantChangeDetected = false;
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.dataset.hiddenByForcefield || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
                            return;
                        }
                        const textContent = node.innerText || node.textContent || '';
                        const trimmedText = textContent.trim();

                        if (trimmedText.length >= MIN_NODE_TEXT_LENGTH && hasSufficientAlphaCharacters(trimmedText, MIN_ALPHA_RATIO)) {
                            newTextBuffer.push(trimmedText);
                            significantChangeDetected = true;
                        }
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        const textContent = node.nodeValue || '';
                        const trimmedText = textContent.trim();
                        if (trimmedText.length >= MIN_NODE_TEXT_LENGTH && hasSufficientAlphaCharacters(trimmedText, MIN_ALPHA_RATIO)) {
                            newTextBuffer.push(trimmedText);
                            significantChangeDetected = true;
                        }
                    }
                });
            }
        }

        if (significantChangeDetected) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (newTextBuffer.length > 0) {
                    const combinedText = newTextBuffer.join('\n\n').trim();
                    newTextBuffer = []; 

                    if (combinedText.length >= MIN_COMBINED_TEXT_LENGTH && hasSufficientAlphaCharacters(combinedText, MIN_ALPHA_RATIO)) {
                        console.log('[Forcefield Continuous Scan] Debounced new text meeting criteria:', combinedText.substring(0,200) + '...');
                        if (canSendMessage()) {
                            chrome.runtime.sendMessage({ command: "newContentDetected", text: combinedText }, (response) => {
                                if (chrome.runtime.lastError) {
                                     console.warn('[Forcefield CS] Error sending newContentDetected:', chrome.runtime.lastError.message);
                                }
                            });
                        } else {
                            console.warn('[Forcefield CS] Context invalidated, cannot send newContentDetected.');
                        }
                    } else {
                        console.log('[Forcefield Continuous Scan] Debounced text too short, numeric, or insignificant, skipping AI call. Length:', combinedText.length, 'Text:', combinedText.substring(0,100) + '...');
                    }
                } else {
                    newTextBuffer = []; 
                }
            }, DEBOUNCE_DELAY);
        }
    }

    function startObserverInternal() {
        if (observer) { 
            observer.disconnect();
            // observer = null; // Not strictly necessary as it's reassigned
        }
        // Clear any pending operations from a previous state
        newTextBuffer = []; 
        clearTimeout(debounceTimer);

        if (!document.body) {
            console.warn('[Forcefield CS] Observer start aborted: document.body not available.');
            isObserving = false; // Ensure scanning state is false if we can't start
            return; 
        }
        
        isObserving = true; // Set to true only if we are proceeding to observe

        // Perform initial scan of existing content
        performInitialScan();

        observer = new MutationObserver(handleMutations);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
        console.log('[Forcefield CS] Observer started/restarted. Initial scan performed.');
    }

    function stopObserverInternal() {
        isObserving = false; 
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        clearTimeout(debounceTimer);
        newTextBuffer = [];
        console.log('[Forcefield CS] Observer stopped.');
    }

    if (!window.forcefieldMessageListenerAdded) {
        if (canSendMessage()) { // Guard the listener attachment itself
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (!canSendMessage()) {
                    console.warn("[Forcefield CS] Context invalidated during message handling.");
                    return false; // Indicate listener should be removed or error occurred
                }
                if (request.command === "startObserving") {
                    console.log('[Forcefield CS] Received startObserving command.');
                    startObserverInternal();
                    sendResponse({ status: "Observer starting in CS" });
                } else if (request.command === "stopObserving") {
                    console.log('[Forcefield CS] Received stopObserving command.');
                    stopObserverInternal();
                    sendResponse({ status: "Observer stopping in CS" });
                } else if (request.command === "queryObserverState") {
                    sendResponse({ isObserving: isObserving, initialized: true });
                }
                return true; 
            });
            window.forcefieldMessageListenerAdded = true;
        } else {
            console.warn("[Forcefield CS] Could not add message listener, context invalidated.");
        }
    }

    if(!window.forcefieldVisibilityListenerAdded) {
        document.addEventListener('visibilitychange', () => {
            if (!canSendMessage()) {
                console.warn("[Forcefield CS] Context invalidated before visibility change handling.");
                return;
            }
            if (document.visibilityState === 'visible') {
                chrome.runtime.sendMessage({ command: "getGlobalScanningState" }, (globalStateResponse) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Forcefield CS] Visibility: Error querying global state:', chrome.runtime.lastError.message); return;
                    }
                    if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after getGlobalScanningState."); return; }

                    if (globalStateResponse && globalStateResponse.isScanningGlobally) {
                        chrome.runtime.sendMessage({ command: "getActiveScanTabId" }, (activeTabResponse) => {
                            if (chrome.runtime.lastError) {
                                console.warn('[Forcefield CS] Visibility: Error getting active tab:', chrome.runtime.lastError.message); return;
                            }
                            if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after getActiveScanTabId."); return; }

                            chrome.runtime.sendMessage({ command: "getCurrentTabId" }, (currentTabResponse) => {
                                if (chrome.runtime.lastError || !currentTabResponse || !currentTabResponse.tabId) {
                                    console.warn('[Forcefield CS] Visibility: Error getting current tab ID'); return;
                                }
                                if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after getCurrentTabId."); return; }

                                const currentTabId = currentTabResponse.tabId;
                                const activeScanTabIdFromBg = activeTabResponse && activeTabResponse.activeScanTabId;
                                if (activeScanTabIdFromBg === currentTabId) {
                                    if (!isObserving) {
                                        console.log('[Forcefield CS] Visibility: Tab is active, starting observer.');
                                        startObserverInternal();
                                    }
                                } else {
                                    if (isObserving) {
                                        console.log('[Forcefield CS] Visibility: Tab not active scan tab, stopping observer.');
                                        stopObserverInternal();
                                    }
                                }
                            });
                        });
                    } else { 
                        if (isObserving) {
                            console.log('[Forcefield CS] Visibility: Global scan off, stopping observer.');
                            stopObserverInternal();
                        }
                    }
                });
            }
        });
        window.forcefieldVisibilityListenerAdded = true;
    }
    
    if (!isObserving) { 
        if (canSendMessage()) {
            chrome.runtime.sendMessage({ command: "getGlobalScanningState" }, (globalStateResponse) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Forcefield CS] Initial: Error querying global state:', chrome.runtime.lastError.message); return;
                }
                if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after initial getGlobalScanningState."); return; }

                if (globalStateResponse && globalStateResponse.isScanningGlobally) {
                    chrome.runtime.sendMessage({ command: "getActiveScanTabId" }, (activeTabResponse) => {
                        if (chrome.runtime.lastError) {
                            console.warn('[Forcefield CS] Initial: Error getting active tab:', chrome.runtime.lastError.message); return;
                        }
                        if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after initial getActiveScanTabId."); return; }

                        chrome.runtime.sendMessage({ command: "getCurrentTabId" }, (currentTabResponse) => {
                            if (chrome.runtime.lastError || !currentTabResponse || !currentTabResponse.tabId) {
                                console.warn('[Forcefield CS] Initial: Error getting current tab ID'); return;
                            }
                            if (!canSendMessage()) { console.warn("[Forcefield CS] Context invalidated after initial getCurrentTabId."); return; }

                            if (activeTabResponse && activeTabResponse.activeScanTabId === currentTabResponse.tabId) {
                                console.log('[Forcefield CS] Initial: This tab should be active. Starting observer.');
                                startObserverInternal();
                            } 
                        });
                    });
                } 
            });
        } else {
            console.warn("[Forcefield CS] Context invalidated, cannot perform initial state check.");
        }
    }

} else {
    // Script already initialized block
}

// The functions startObserverInternal, stopObserverInternal, and handleMutations
// are now defined within the main initialization block.
// The message listener calls these internal functions.

// Optional: Check initial state if the script is reloaded/re-injected
// This helps if the extension popup was closed and reopened while scanning was active.
chrome.storage.local.get(['isScanning'], (result) => {
    if (result.isScanning) {
        // console.log('[Forcefield Continuous Scan] Script loaded/re-injected while scanning was globally active.');
        // The popup.js logic (loadScanningState -> pingContentScriptObserverState -> startContinuousScanningLogic)
        // is now responsible for explicitly telling this script to start observing if needed for the current tab.
        // No automatic startObserver() call here anymore.
    } else {
        // console.log('[Forcefield Continuous Scan] Initial state is not scanning.');
    }
}); 