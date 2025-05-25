// Unified logging system
class Logger {
    constructor(prefix = 'Forcefield') {
        this.prefix = prefix;
    }

    // Log to extension console
    log(level, ...args) {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        console[level](`[${this.prefix} ${timestamp}]`, ...args);
    }

    info(...args) { this.log('log', ...args); }
    warn(...args) { this.log('warn', ...args); }
    error(...args) { this.log('error', ...args); }

    // Log to page console (for content scripts)
    async toPage(tabId, ...args) {
        if (!tabId) {
            this.warn('toPage called without tabId, falling back to extension console:', ...args);
            this.info(...args);
            return;
        }

        try {
            const serializedArgs = args.map(arg => 
                typeof arg === 'object' && arg !== null ? JSON.stringify(arg, null, 2) : String(arg)
            );

            await chrome.scripting.executeScript({
                target: { tabId },
                func: (prefix, ...logs) => console.log(`[${prefix}]`, ...logs),
                args: [this.prefix, ...serializedArgs]
            });
        } catch (error) {
            this.warn('Failed to log to page console:', error.message, 'Original args:', ...args);
        }
    }

    // Log to active tab
    async toActiveTab(...args) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                await this.toPage(tab.id, ...args);
            } else {
                this.warn('No active tab found, logging to extension console:', ...args);
                this.info(...args);
            }
        } catch (error) {
            this.warn('Failed to get active tab:', error.message);
            this.info(...args);
        }
    }

    // Create scoped logger
    scope(scopeName) {
        return new Logger(`${this.prefix} ${scopeName}`);
    }
}

// Create global instances
const logger = new Logger();
const aiLogger = logger.scope('AI');
const scanLogger = logger.scope('Scanner');
const bgLogger = logger.scope('Background');

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.Logger = Logger;
    window.logger = logger;
    window.aiLogger = aiLogger;
    window.scanLogger = scanLogger;
    window.bgLogger = bgLogger;
} 