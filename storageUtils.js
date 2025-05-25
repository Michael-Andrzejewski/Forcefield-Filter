// Storage utility functions
const StorageUtils = {
    // Get multiple values with defaults
    async getMultiple(keys, storage = chrome.storage.local) {
        return new Promise(resolve => {
            const keyMap = typeof keys === 'object' ? keys : keys.reduce((acc, key) => ({ ...acc, [key]: null }), {});
            storage.get(Object.keys(keyMap), result => {
                const merged = { ...keyMap, ...result };
                resolve(merged);
            });
        });
    },

    // Set multiple values
    async setMultiple(data, storage = chrome.storage.local) {
        return new Promise(resolve => {
            storage.set(data, resolve);
        });
    },

    // Common app state getters
    async getAppState() {
        return this.getMultiple({
            blockList: [],
            isScanning: false,
            debugMode: false
        });
    },

    async getAIConfig() {
        return this.getMultiple({
            customSystemPrompt: null,
            customUserPromptPrefix: null,
            selectedAiModel: 'claude-3-5-sonnet-20240620'
        }, chrome.storage.sync);
    },

    // Update block list with new items
    async addToBlockList(newItems, source = 'manual') {
        const { blockList } = await this.getAppState();
        const existing = new Set(blockList.map(item => item.text.toLowerCase()));
        
        const toAdd = newItems.filter(item => {
            const text = typeof item === 'string' ? item : item.text;
            return !existing.has(text.toLowerCase());
        }).map(item => typeof item === 'string' ? { text: item, level: 1, source } : item);

        if (toAdd.length > 0) {
            const updated = [...blockList, ...toAdd];
            await this.setMultiple({ blockList: updated });
            return { added: toAdd, total: updated };
        }
        return { added: [], total: blockList };
    }
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.StorageUtils = StorageUtils;
} 