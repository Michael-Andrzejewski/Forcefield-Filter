// Ensure the script only initializes once per page context
if (typeof window.forcefieldObserverInitialized === 'undefined') {
    window.forcefieldObserverInitialized = true;

    let observer = null;
    let debounceTimer = null;
    let newTextBuffer = []; // Collects text from mutations
    let newKeyBuffer = []; // Tweet keys for the tweets in newTextBuffer (X only)
    let newTweetBuffer = []; // [{text, handle}] per tweet, for per-tweet engines like Jev (X only)
    let isObserving = false; // This will be controlled by messages
    const DEBOUNCE_DELAY = 1000; // 1 second — batches mutations so a fast scroll is one AI call, not ten
    const MIN_NODE_TEXT_LENGTH = 5; // Minimum length for a single node's text to be considered
    const MIN_COMBINED_TEXT_LENGTH = 50; // Minimum length for the combined text to be sent to AI
    const MIN_ALPHA_RATIO = 0.7; // Minimum ratio of alphabetic characters in the text

    // On X/Twitter, send ONLY tweet text to the AI (not nav chrome, counts,
    // usernames, ads scaffolding) and dedupe tweets we've already sent. X's
    // virtualized timeline re-mounts the same tweets constantly while
    // scrolling — without dedup every re-mount would be re-billed.
    const IS_TWITTER = /(^|\.)(twitter|x)\.com$/.test(location.hostname);
    const sentTweetKeys = new Set();
    const SENT_KEYS_MAX = 1000;

    function rememberTweetKey(key) {
        sentTweetKeys.add(key);
        if (sentTweetKeys.size > SENT_KEYS_MAX) {
            // Sets iterate in insertion order; drop the oldest entry.
            sentTweetKeys.delete(sentTweetKeys.values().next().value);
        }
    }

    // Tweets are marked as sent before the background has accepted them. If
    // it then turns them away (scan not started for this tab yet, no API
    // key), forget them so the next scan retries them instead of skipping
    // them forever.
    function forgetTweetKeys(keys) {
        for (const key of keys) sentTweetKeys.delete(key);
    }

    // Sends a batch to the background. `keys` are the tweet keys inside it.
    function sendNewContent(text, keys, logLabel, tweets) {
        chrome.runtime.sendMessage({ command: "newContentDetected", text: text, tweets: tweets || [] }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`[Forcefield CS] Error sending newContentDetected (${logLabel}):`, chrome.runtime.lastError.message);
                forgetTweetKeys(keys);
            } else if (!response || response.accepted === false) {
                console.log(`[Forcefield CS] Background did not scan this batch (${logLabel}): ${response && response.reason}. Will retry these tweets.`);
                forgetTweetKeys(keys);
            }
        });
    }

    // Collect tweet texts under `root` that we have NOT sent to the AI yet.
    // Returns { texts, keys, tweets, sawTweets } — tweets is [{text, handle}];
    // sawTweets is true if ANY tweet
    // rendered (even an already-sent one), so the caller still re-runs the blocker.
    function collectNewTweetTexts(root) {
        const texts = [];
        const keys = [];
        const tweets = [];
        let sawTweets = false;
        const els = [];
        if (root.matches && root.matches('[data-testid="tweetText"]')) els.push(root);
        if (root.querySelectorAll) els.push(...root.querySelectorAll('[data-testid="tweetText"]'));
        for (const el of els) {
            const t = (el.innerText || el.textContent || '').trim();
            if (t.length < MIN_NODE_TEXT_LENGTH) continue;
            sawTweets = true;
            const key = t.slice(0, 100);
            if (!sentTweetKeys.has(key)) {
                rememberTweetKey(key);
                texts.push(t);
                keys.push(key);
                tweets.push({ text: t, handle: handleOf(el) });
            }
        }
        return { texts: texts, keys: keys, tweets: tweets, sawTweets: sawTweets };
    }

    // "@handle" of the post a tweetText element belongs to, or ''.
    function handleOf(el) {
        const article = el.closest && el.closest('article');
        const nameEl = article && article.querySelector('[data-testid="User-Name"]');
        if (!nameEl) return '';
        return (nameEl.innerText || '').split(/\n/).map(s => s.trim()).find(l => l.startsWith('@')) || '';
    }

    // After the extension is reloaded or updated, the copy of this script
    // already running in open tabs is orphaned: chrome.runtime.sendMessage
    // still EXISTS but throws "Extension context invalidated". chrome.runtime.id
    // is the reliable signal (it becomes undefined). The first time we see it,
    // shut this orphan down so it stops touching the page and stops throwing;
    // the freshly injected copy does the real work.
    let orphaned = false;
    function canSendMessage() {
        let alive = false;
        try { alive = !!(chrome.runtime && chrome.runtime.id); } catch (e) { alive = false; }
        if (!alive && !orphaned) shutDownOrphan();
        return alive;
    }

    function shutDownOrphan() {
        orphaned = true;
        isObserving = false;
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(debounceTimer);
        newTextBuffer = [];
        newKeyBuffer = [];
        newTweetBuffer = [];
        if (onVisibilityChange) document.removeEventListener('visibilitychange', onVisibilityChange);
        // Let a re-injected copy of this script initialize from scratch.
        window.forcefieldObserverInitialized = undefined;
        window.forcefieldMessageListenerAdded = undefined;
        window.forcefieldVisibilityListenerAdded = undefined;
        console.log('[Forcefield CS] Extension was reloaded; this old copy of the page script has shut down. Refresh the page if scanning stops.');
    }
    let onVisibilityChange = null;

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
        let initialKeys = [];
        let initialTweets = [];

        if (IS_TWITTER) {
            // Tweet-only mode: collect just the tweet bodies on screen.
            const found = collectNewTweetTexts(document.body);
            initialScanBuffer.push(...found.texts);
            initialKeys = found.keys;
            initialTweets = found.tweets;
        }

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

        if (!IS_TWITTER) {
            collectVisibleTextRecursive(document.body, initialScanBuffer);
        }

        if (initialScanBuffer.length > 0) {
            const combinedText = initialScanBuffer.join('\n\n').trim();
            if (combinedText.length >= MIN_COMBINED_TEXT_LENGTH && hasSufficientAlphaCharacters(combinedText, MIN_ALPHA_RATIO)) {
                console.log('[Forcefield Continuous Scan] Initial page scan text meeting criteria:', combinedText.substring(0, 200) + '...');
                if (canSendMessage()) {
                    sendNewContent(combinedText, initialKeys, 'initial scan', initialTweets);
                } else {
                    console.warn('[Forcefield CS] Context invalidated, cannot send newContentDetected (initial scan).');
                    forgetTweetKeys(initialKeys);
                }
            } else {
                console.log('[Forcefield Continuous Scan] Initial scan text too short, numeric, or insignificant, skipping AI call. Length:', combinedText.length, 'Text:', combinedText.substring(0,100) + '...');
                forgetTweetKeys(initialKeys);
            }
        } else {
            console.log('[Forcefield Continuous Scan] Initial scan found no significant text to process.');
        }
    }

    function handleMutations(mutationsList, obs) {
        if (!isObserving) return; // Check against the script-local isObserving

        let significantChangeDetected = false;

        if (IS_TWITTER) {
            // Tweet-only mode: pull tweet bodies out of newly mounted subtrees.
            // Already-sent tweets still count as a "change" so the blocker
            // re-applies to them, but they aren't re-sent to the AI.
            for (const mutation of mutationsList) {
                if (mutation.type !== 'childList') continue;
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE) continue;
                    const found = collectNewTweetTexts(node);
                    if (found.sawTweets) significantChangeDetected = true;
                    if (found.texts.length > 0) newTextBuffer.push(...found.texts);
                    if (found.keys.length > 0) newKeyBuffer.push(...found.keys);
                    if (found.tweets.length > 0) newTweetBuffer.push(...found.tweets);
                }
            }
            scheduleDebouncedFlush(significantChangeDetected);
            return;
        }

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    // Check if the node itself or its parent should be ignored.
                    // This is important if a text node is added directly under an ignored parent.
                    let Curnode = node;
                    if (Curnode.nodeType === Node.TEXT_NODE) {
                        Curnode = Curnode.parentNode; // Check exclusion rules on the parent element
                    }

                    if (Curnode && Curnode.nodeType === Node.ELEMENT_NODE) {
                         if (Curnode.dataset.hiddenByForcefield ||
                             Curnode.tagName === 'SCRIPT' ||
                             Curnode.tagName === 'STYLE' ||
                             Curnode.tagName === 'NOSCRIPT' ||
                             Curnode.tagName === 'IFRAME'   ||
                             Curnode.tagName === 'TEXTAREA' ||
                             Curnode.tagName === 'CANVAS'
                             ) {
                            return; // Skip this node
                        }
                    }


                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Element node specific checks already in place (tagName, dataset)
                        // No need to re-check Curnode related exclusions if node itself is an element being evaluated
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
            } else if (mutation.type === 'characterData') {
                const targetNode = mutation.target;
                // Ensure we're dealing with a text node and it has a parent
                if (targetNode && targetNode.nodeType === Node.TEXT_NODE && targetNode.parentNode) {
                    const parentElement = targetNode.parentNode;

                    // Check if the parent element is one we should ignore
                    if (parentElement.dataset.hiddenByForcefield ||
                        parentElement.tagName === 'SCRIPT' ||
                        parentElement.tagName === 'STYLE' ||
                        parentElement.tagName === 'NOSCRIPT' ||
                        parentElement.tagName === 'IFRAME'   ||
                        parentElement.tagName === 'TEXTAREA' ||
                        parentElement.tagName === 'CANVAS'
                        ) {
                        // Skip if the parent is an ignored element
                        continue;
                    }

                    const textContent = targetNode.nodeValue || '';
                    const trimmedText = textContent.trim();

                    if (trimmedText.length >= MIN_NODE_TEXT_LENGTH && hasSufficientAlphaCharacters(trimmedText, MIN_ALPHA_RATIO)) {
                        newTextBuffer.push(trimmedText);
                        significantChangeDetected = true;
                    }
                }
            }
        }

        scheduleDebouncedFlush(significantChangeDetected);
    }

    // Debounced flush shared by the generic and tweet-only mutation paths:
    // re-applies the blocklist to whatever just rendered, and ships any new
    // buffered text to the AI if it clears the significance bar.
    function scheduleDebouncedFlush(significantChangeDetected) {
        if (significantChangeDetected) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                // Re-apply the existing blocklist to whatever just rendered. This is
                // cheap and local (no AI call) and is what keeps already-flagged posts
                // hidden/highlighted as X's virtualized timeline mounts and unmounts
                // them during scrolling.
                if (canSendMessage()) {
                    chrome.runtime.sendMessage({ command: "runBlocker" }, () => {
                        void chrome.runtime.lastError; // ignore; background may be waking up
                    });
                }
                if (newTextBuffer.length > 0) {
                    const combinedText = newTextBuffer.join('\n\n').trim();
                    const keys = newKeyBuffer;
                    const tweets = newTweetBuffer;
                    newTextBuffer = [];
                    newKeyBuffer = [];
                    newTweetBuffer = [];

                    if (combinedText.length >= MIN_COMBINED_TEXT_LENGTH && hasSufficientAlphaCharacters(combinedText, MIN_ALPHA_RATIO)) {
                        console.log('[Forcefield Continuous Scan] Debounced new text meeting criteria:', combinedText.substring(0,200) + '...');
                        if (canSendMessage()) {
                            sendNewContent(combinedText, keys, 'debounced', tweets);
                        } else {
                            console.warn('[Forcefield CS] Context invalidated, cannot send newContentDetected. Payload that would have been sent:', { command: "newContentDetected", text: combinedText.substring(0,100) + '...'});
                        }
                    } else {
                        console.log('[Forcefield Continuous Scan] Debounced text too short, numeric, or insignificant, skipping AI call. Length:', combinedText.length, 'Text:', combinedText.substring(0,100) + '...');
                        // Too little text to scan alone: let these tweets ride
                        // along with the next batch instead of dropping them.
                        forgetTweetKeys(keys);
                    }
                } else {
                    newTextBuffer = [];
                    newKeyBuffer = [];
                    newTweetBuffer = [];
                }
            }, DEBOUNCE_DELAY);
        }
    }

    function startObserverInternal() {
        if (observer) { 
            observer.disconnect();
            // observer = null; // Not strictly necessary as it's reassigned
        }
        // Clear any pending operations from a previous state. Unsent tweets
        // are forgotten so the initial scan below picks them up again.
        forgetTweetKeys(newKeyBuffer);
        newTextBuffer = [];
        newKeyBuffer = [];
        newTweetBuffer = [];
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
            characterData: true, // Added to observe text changes in existing nodes
            // characterDataOldValue: true // Optional: if you need the old value
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
        forgetTweetKeys(newKeyBuffer);
        newTextBuffer = [];
        newKeyBuffer = [];
        newTweetBuffer = [];
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

    // Ask the background whether this tab should scan: yes when scanning is
    // on, the site is allowed, and this tab is the one in front (it then
    // becomes the scan tab). Used on page load and when the tab comes back
    // to the front. Replaces a four-message handshake that only started
    // scanning on a tab the background had ALREADY picked, so a refresh or a
    // new X tab stayed idle until the popup was opened.
    function claimScanAndStart(label) {
        if (!canSendMessage()) return; // orphaned: canSendMessage already shut us down
        chrome.runtime.sendMessage({ command: "claimScan" }, (response) => {
            if (chrome.runtime.lastError) {
                console.warn(`[Forcefield CS] ${label}: could not reach the background:`, chrome.runtime.lastError.message);
                return;
            }
            if (response && response.start) {
                if (!isObserving) {
                    console.log(`[Forcefield CS] ${label}: scanning this tab.`);
                    startObserverInternal();
                }
            } else {
                if (isObserving) stopObserverInternal();
                console.log(`[Forcefield CS] ${label}: not scanning (${response && response.reason}).`);
            }
        });
    }

    if(!window.forcefieldVisibilityListenerAdded) {
        onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                claimScanAndStart('Visibility');
            } else if (document.visibilityState === 'hidden') {
                if (isObserving) {
                    console.log('[Forcefield CS] Visibility: Tab became hidden, stopping observer.');
                    stopObserverInternal();
                }
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.forcefieldVisibilityListenerAdded = true;
    }

    if (!isObserving && document.visibilityState === 'visible') {
        claimScanAndStart('Page load');
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