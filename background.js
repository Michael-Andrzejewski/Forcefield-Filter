// Track scanning state
let isScanning = false;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'scanningStarted') {
        isScanning = true;
        // Store scanning state
        chrome.storage.sync.set({ isScanning: true });
    } else if (message.action === 'scanningStopped') {
        isScanning = false;
        // Store scanning state
        chrome.storage.sync.set({ isScanning: false });
    }
});

// Helper function to check if URL is injectable
function isInjectableUrl(url) {
    try {
        const urlObj = new URL(url);
        // Allow http and https URLs, but not chrome://, chrome-extension://, etc.
        return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

// Listen for tab updates to inject content script if scanning is active
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && isScanning && tab.url && isInjectableUrl(tab.url)) {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['contentScanner.js']
        }).then(() => {
            // Start scanning in the new tab
            chrome.tabs.sendMessage(tabId, { action: 'startScanning' });
        }).catch(err => {
            // Log error but don't show to user - this is expected for some URLs
            console.log('Could not inject content scanner:', err.message);
        });
    }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getScanningState') {
        sendResponse({ isScanning });
    }
    return true;
}); 