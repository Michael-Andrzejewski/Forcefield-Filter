// Simplified continuous scanning
if (!window.forcefieldScannerInitialized) {
    window.forcefieldScannerInitialized = true;

    class ContinuousScanner {
        constructor() {
            this.observer = null;
            this.isActive = false;
            this.textBuffer = [];
            this.debounceTimer = null;
            this.config = {
                debounceDelay: 1000,
                minTextLength: 50,
                minAlphaRatio: 0.7
            };
            
            this.setupMessageHandlers();
            this.setupVisibilityHandler();
            this.checkInitialState();
        }

        setupMessageHandlers() {
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                const handlers = {
                    startObserving: () => this.start(),
                    stopObserving: () => this.stop(),
                    queryObserverState: () => ({ isObserving: this.isActive, initialized: true })
                };

                const handler = handlers[request.command];
                if (handler) {
                    sendResponse(handler());
                    return true;
                }
            });
        }

        setupVisibilityHandler() {
            document.addEventListener('visibilitychange', async () => {
                if (document.visibilityState === 'visible') {
                    const state = await this.getGlobalState();
                    if (state.isScanning && state.isActiveTab) {
                        this.start();
                    } else {
                        this.stop();
                    }
                }
            });
        }

        async getGlobalState() {
            try {
                const [globalState, activeTab, currentTab] = await Promise.all([
                    chrome.runtime.sendMessage({ command: "getGlobalScanningState" }),
                    chrome.runtime.sendMessage({ command: "getActiveScanTabId" }),
                    chrome.runtime.sendMessage({ command: "getCurrentTabId" })
                ]);

                return {
                    isScanning: globalState?.isScanningGlobally || false,
                    isActiveTab: activeTab?.activeScanTabId === currentTab?.tabId
                };
            } catch {
                return { isScanning: false, isActiveTab: false };
            }
        }

        async checkInitialState() {
            const state = await this.getGlobalState();
            if (state.isScanning && state.isActiveTab) {
                this.start();
            }
        }

        start() {
            if (this.isActive) return;
            
            this.stop(); // Clean slate
            this.isActive = true;
            this.textBuffer = [];
            
            this.observer = new MutationObserver(this.handleMutations.bind(this));
            this.observer.observe(document.body, { childList: true, subtree: true });
            
            console.log('[Forcefield Scanner] Started');
            return { status: "Observer started" };
        }

        stop() {
            this.isActive = false;
            this.observer?.disconnect();
            this.observer = null;
            clearTimeout(this.debounceTimer);
            this.textBuffer = [];
            
            console.log('[Forcefield Scanner] Stopped');
            return { status: "Observer stopped" };
        }

        handleMutations(mutations) {
            if (!this.isActive) return;

            const newText = mutations
                .flatMap(m => Array.from(m.addedNodes))
                .filter(node => this.isValidNode(node))
                .map(node => this.extractText(node))
                .filter(text => this.isValidText(text));

            if (newText.length > 0) {
                this.textBuffer.push(...newText);
                this.debounceProcess();
            }
        }

        isValidNode(node) {
            if (node.nodeType === Node.TEXT_NODE) return true;
            if (node.nodeType === Node.ELEMENT_NODE) {
                return !node.dataset?.hiddenByForcefield && 
                       !['SCRIPT', 'STYLE'].includes(node.tagName);
            }
            return false;
        }

        extractText(node) {
            const text = (node.innerText || node.textContent || node.nodeValue || '').trim();
            return text;
        }

        isValidText(text) {
            if (text.length < 5) return false;
            const alphaChars = text.match(/[a-zA-Z]/g);
            return alphaChars && (alphaChars.length / text.length) >= this.config.minAlphaRatio;
        }

        debounceProcess() {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => {
                const combinedText = this.textBuffer.join('\n\n').trim();
                this.textBuffer = [];

                if (combinedText.length >= this.config.minTextLength && this.isValidText(combinedText)) {
                    chrome.runtime.sendMessage({ 
                        command: "newContentDetected", 
                        text: combinedText 
                    }).catch(() => {}); // Silent fail
                }
            }, this.config.debounceDelay);
        }
    }

    // Initialize scanner
    new ContinuousScanner();
} 