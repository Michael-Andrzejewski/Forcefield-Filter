// Simplified message handling system
class MessageHandler {
    constructor() {
        this.handlers = new Map();
        this.setupListener();
    }

    // Register command handlers
    on(command, handler) {
        this.handlers.set(command, handler);
        return this;
    }

    // Send message with automatic error handling
    async send(command, data = {}, tabId = null) {
        const message = { command, ...data };
        
        try {
            if (tabId) {
                return await chrome.tabs.sendMessage(tabId, message);
            } else {
                return await chrome.runtime.sendMessage(message);
            }
        } catch (error) {
            console.warn(`[MessageHandler] Failed to send ${command}:`, error.message);
            return null;
        }
    }

    // Setup the main listener
    setupListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            const handler = this.handlers.get(request.command);
            if (!handler) return false;

            // Handle both sync and async handlers
            const result = handler(request, sender);
            if (result instanceof Promise) {
                result.then(sendResponse).catch(err => {
                    console.error(`[MessageHandler] Handler error for ${request.command}:`, err);
                    sendResponse({ error: err.message });
                });
                return true; // Keep channel open
            } else {
                sendResponse(result);
                return false;
            }
        });
    }

    // Utility for tab-specific operations
    async withActiveTab(callback) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab ? await callback(tab) : null;
        } catch (error) {
            console.error('[MessageHandler] Active tab operation failed:', error);
            return null;
        }
    }
}

// Create global instance
const messageHandler = new MessageHandler();

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.MessageHandler = MessageHandler;
    window.messageHandler = messageHandler;
} 