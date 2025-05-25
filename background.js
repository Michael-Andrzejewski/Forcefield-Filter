// Simplified background script using utility modules
importScripts('logger.js', 'storageUtils.js', 'messageHandler.js', 'contentBlocker.js');

// Configuration
const CONFIG = {
    API_KEY: 'REDACTED_ANTHROPIC_API_KEY',
    DEFAULT_SYSTEM_PROMPT: `Your task is to identify potentially controversial, politically charged, or negative statements within the provided text content. Ignore common interface elements like buttons, navigation text ('Home', 'About', 'Contact'), etc., unless they are part of a larger controversial statement.

Focus on extracting specific statements (phrases or sentences) that:
- Criticize political figures or parties
- Make controversial claims
- Contain strong negative opinions or insults
- Discuss polarizing social or political topics
- Use inflammatory or charged language

For each identified statement, wrap it precisely with <Negative> tags. Only include the exact text you want tagged.
Do NOT add explanations, apologies, or any text outside the <Negative> tags.
Do NOT tag entire paragraphs; the tool only works on single statements.
Be selective and only tag genuinely negative/controversial content, not neutral descriptions or news headlines.

Example Input Text:
'The new policy announced yesterday is terrible. Many people are upset. Read more on our blog. Meanwhile, the weather is nice.'

Example Correct Output:
<Negative>The new policy announced yesterday is terrible.</Negative>
<Negative>Many people are upset.</Negative>`,
    DEFAULT_USER_PREFIX: "Analyze the following text content and extract potentially controversial, politically charged, or negative statements using <Negative> tags as instructed:\n\n----\n",
    DEFAULT_USER_SUFFIX: "\n----\n\nRemember to only return the tagged statements, nothing else.",
    AVAILABLE_MODELS: {
        'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet (New)',
        'claude-3-opus-20240229': 'Claude 3 Opus',
        'claude-3-sonnet-20240229': 'Claude 3 Sonnet (Older)',
        'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku'
    },
    DEFAULT_MODEL: 'claude-3-5-sonnet-20240620',
    SITE_DEFAULTS: {
        'twitter.com': 8,
        'x.com': 8,
        'quora.com': 10
    }
};

// State management
let activeScanTabId = null;
let currentAiController = null;

// Utility functions
function extractNegativeTags(text) {
    const matches = [];
    const regex = /<Negative>(.*?)<\/Negative>/gs;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const suggestion = match[1].trim();
        if (suggestion) matches.push(suggestion);
    }
    return matches;
}

function getDefaultLevel(url) {
    if (!url) return 1;
    try {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        return CONFIG.SITE_DEFAULTS[hostname] || 1;
    } catch {
        return 1;
    }
}

// AI Processing
async function processWithAI(text, tabId) {
    bgLogger.info(`Processing content for tab ${tabId}`);
    
    // Cancel previous request
    if (currentAiController) {
        currentAiController.abort();
    }
    currentAiController = new AbortController();

    try {
        const [appState, aiConfig] = await Promise.all([
            StorageUtils.getAppState(),
            StorageUtils.getAIConfig()
        ]);

        if (!appState.isScanning || activeScanTabId !== tabId) {
            bgLogger.info('Scanning stopped or tab changed, aborting AI processing');
            return;
        }

        const systemPrompt = aiConfig.customSystemPrompt || CONFIG.DEFAULT_SYSTEM_PROMPT;
        const userPrefix = aiConfig.customUserPromptPrefix ?? CONFIG.DEFAULT_USER_PREFIX;
        const model = CONFIG.AVAILABLE_MODELS[aiConfig.selectedAiModel] ? aiConfig.selectedAiModel : CONFIG.DEFAULT_MODEL;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': CONFIG.API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model,
                max_tokens: 4096,
                temperature: 0.5,
                system: systemPrompt,
                messages: [{ role: "user", content: `${userPrefix}${text}${CONFIG.DEFAULT_USER_SUFFIX}` }]
            }),
            signal: currentAiController.signal
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        const content = result.content?.[0]?.text || '';
        const suggestions = extractNegativeTags(content);

        if (suggestions.length > 0) {
            const tab = await chrome.tabs.get(tabId);
            const defaultLevel = getDefaultLevel(tab.url);
            
            const { added } = await StorageUtils.addToBlockList(
                suggestions.map(text => ({ text, level: defaultLevel, source: 'ai_continuous' }))
            );

            if (added.length > 0) {
                await triggerPageBlock(tabId, await StorageUtils.getAppState());
                bgLogger.info(`Added ${added.length} new blocks for tab ${tabId}`);
            }
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            bgLogger.error('AI processing failed:', error.message);
        }
    } finally {
        currentAiController = null;
    }
}

// Content blocking
async function triggerPageBlock(tabId, appState = null) {
    if (!appState) appState = await StorageUtils.getAppState();
    
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['contentBlocker.js']
        });
        
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (blockList, debugMode) => {
                if (window.forcefieldBlockContent) {
                    window.forcefieldBlockContent(blockList, debugMode);
                }
            },
            args: [appState.blockList, appState.debugMode]
        });
    } catch (error) {
        bgLogger.warn(`Failed to trigger blocking on tab ${tabId}:`, error.message);
    }
}

// Tab management
async function switchScanningTab(newTabId) {
    if (activeScanTabId === newTabId) return;
    
    const oldTabId = activeScanTabId;
    activeScanTabId = newTabId;
    
    // Stop old tab
    if (oldTabId) {
        await messageHandler.send('stopObserving', {}, oldTabId);
    }
    
    // Start new tab
    if (newTabId) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: newTabId },
                files: ['logger.js', 'continuousScan.js']
            });
            await messageHandler.send('startObserving', {}, newTabId);
        } catch (error) {
            bgLogger.warn(`Failed to start scanning on tab ${newTabId}:`, error.message);
        }
    }
}

// Message handlers
messageHandler
    .on('newContentDetected', async (request, sender) => {
        if (sender.tab?.id === activeScanTabId) {
            await processWithAI(request.text, sender.tab.id);
        }
        return { status: 'processed' };
    })
    .on('startContinuousScanBG', async (request) => {
        await switchScanningTab(request.tabId);
        return { status: 'started' };
    })
    .on('stopContinuousScanBG', async (request) => {
        if (activeScanTabId === request.tabId) {
            await switchScanningTab(null);
            if (currentAiController) {
                currentAiController.abort();
            }
        }
        return { status: 'stopped' };
    })
    .on('getActiveScanTabId', () => ({ activeScanTabId }))
    .on('getGlobalScanningState', async () => {
        const { isScanning } = await StorageUtils.getAppState();
        return { isScanningGlobally: isScanning };
    })
    .on('getCurrentTabId', (request, sender) => ({ tabId: sender.tab?.id || null }));

// Tab activation listener
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const { isScanning } = await StorageUtils.getAppState();
    if (isScanning) {
        await switchScanningTab(activeInfo.tabId);
    }
});

bgLogger.info('Background script initialized'); 