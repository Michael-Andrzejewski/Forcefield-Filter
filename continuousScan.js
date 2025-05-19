let observer = null;
let debounceTimer = null;
let newTextBuffer = []; // Collects text from mutations
let isObserving = false;
const DEBOUNCE_DELAY = 1000; // 1 second
const MIN_NODE_TEXT_LENGTH = 5; // Minimum length for a single node's text to be considered
const MIN_COMBINED_TEXT_LENGTH = 25; // Minimum length for the combined text to be sent to AI
const MIN_ALPHA_RATIO = 0.3; // Minimum ratio of alphabetic characters in the text

// Helper function to check if text has a minimum ratio of alphabetic characters
function hasSufficientAlphaCharacters(text, minRatio) {
    if (!text || text.length === 0) return false;
    const alphaChars = text.match(/[a-zA-Z]/g);
    if (!alphaChars) return false;
    return (alphaChars.length / text.length) >= minRatio;
}

function handleMutations(mutationsList, obs) {
    if (!isObserving) return;

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
                newTextBuffer = []; // Clear buffer before potential early exit

                if (combinedText.length >= MIN_COMBINED_TEXT_LENGTH && hasSufficientAlphaCharacters(combinedText, MIN_ALPHA_RATIO)) {
                    console.log('[Forcefield Continuous Scan] Debounced new text meeting criteria:', combinedText);
                    chrome.runtime.sendMessage({ command: "newContentDetected", text: combinedText });
                } else {
                    console.log('[Forcefield Continuous Scan] Debounced text too short, numeric, or insignificant, skipping AI call. Length:', combinedText.length, 'Text:', combinedText.substring(0,100) + '...');
                }
            } else {
                 // This case should ideally not be reached if significantChangeDetected was true
                 // but as a safeguard, clear buffer if it somehow became empty.
                newTextBuffer = []; 
            }
        }, DEBOUNCE_DELAY);
    }
}

function startObserver() {
    if (observer) return; // Already observing
    isObserving = true;
    newTextBuffer = [];
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { 
        childList: true, 
        subtree: true,
        // Consider adding characterData: true if needed, but can be noisy
    });
    console.log('[Forcefield] Continuous scanning observer started.');
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "Scanning active..." });
}

function stopObserver() {
    isObserving = false;
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    clearTimeout(debounceTimer);
    newTextBuffer = []; // Clear any pending text
    console.log('[Forcefield] Continuous scanning observer stopped.');
    chrome.runtime.sendMessage({ command: "scanningStateChanged", status: "Scanning stopped." });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Forcefield Continuous Scan] Message received:', request.command);
    if (request.command === "startObserving") {
        console.log('[Forcefield Continuous Scan] Received startObserving command.');
        startObserver();
        sendResponse({ status: "Observer starting" });
    } else if (request.command === "stopObserving") {
        console.log('[Forcefield Continuous Scan] Received stopObserving command.');
        stopObserver();
        sendResponse({ status: "Observer stopping" });
    } else if (request.command === "queryObserverState") {
        console.log('[Forcefield Continuous Scan] Received queryObserverState command. isObserving:', isObserving);
        sendResponse({ isObserving: isObserving });
    }
    return true; // Keep the message channel open for asynchronous response
});

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