// autonomousAgent.js - Forcefield autonomous curation session.
//
// Injected into an x.com tab by the background script (Run Now button or the
// nightly alarm). Scrolls the feed, batches tweet texts to the background for
// an LLM verdict, then performs the chosen actions through X's own UI: the
// tweet's caret menu -> "Not interested in this post" or "Mute @handle".
// Never blocks or reports. Shows a live overlay so the user can watch and stop.
//
// Safety rails: hard caps on mutes / not-interested / posts scanned / duration
// (config comes from the background), and every action is logged to the run
// summary stored in chrome.storage.local (key: lastAutonomousRun).
(() => {
    if (window.__forcefieldAutonomousActive) {
        console.log('[Forcefield Autonomous] Session already running; ignoring start request.');
        return;
    }
    window.__forcefieldAutonomousActive = true;

    const TAG = '[Forcefield Autonomous]';
    let stopRequested = false;
    let stopReason = '';
    const stats = { scanned: 0, muted: [], notInterested: [], errors: 0, batches: 0 };

    // ---- Overlay UI --------------------------------------------------------
    let overlay, statusEl, logEl, stopBtn;
    function buildOverlay() {
        overlay = document.createElement('div');
        overlay.id = 'forcefield-autonomous-overlay';
        overlay.style.cssText = 'position:fixed;bottom:16px;right:16px;width:340px;max-height:60vh;' +
            'z-index:2147483647;background:rgba(20,24,32,0.96);color:#e8ecf1;border:1px solid #3d4654;' +
            'border-radius:12px;font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;' +
            'box-shadow:0 8px 30px rgba(0,0,0,0.45);display:flex;flex-direction:column;overflow:hidden;';

        const header = document.createElement('div');
        header.style.cssText = 'padding:10px 12px;background:rgba(52,152,219,0.15);border-bottom:1px solid #3d4654;' +
            'font-weight:600;font-size:13px;display:flex;justify-content:space-between;align-items:center;';
        header.textContent = 'Forcefield Autonomous Curation';

        stopBtn = document.createElement('button');
        stopBtn.textContent = 'Stop';
        stopBtn.style.cssText = 'background:#e74c3c;color:#fff;border:none;border-radius:6px;' +
            'padding:4px 12px;font-size:12px;font-weight:600;cursor:pointer;';
        stopBtn.addEventListener('click', () => {
            if (window.__forcefieldAutonomousActive) {
                stopRequested = true;
                stopReason = 'stopped by user';
                setStatus('Stopping...');
            } else {
                overlay.remove(); // session over: button acts as Close
            }
        });
        header.appendChild(stopBtn);

        statusEl = document.createElement('div');
        statusEl.style.cssText = 'padding:8px 12px;color:#7fd1a8;font-weight:600;border-bottom:1px solid #2b323e;';
        statusEl.textContent = 'Starting...';

        logEl = document.createElement('div');
        logEl.style.cssText = 'padding:8px 12px;overflow-y:auto;flex:1;min-height:60px;max-height:38vh;';

        overlay.appendChild(header);
        overlay.appendChild(statusEl);
        overlay.appendChild(logEl);
        document.documentElement.appendChild(overlay);
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function logLine(text, kind) {
        console.log(TAG, text);
        if (!logEl) return;
        const line = document.createElement('div');
        line.style.cssText = 'margin-bottom:5px;border-left:3px solid ' +
            (kind === 'action' ? '#2ecc71' : kind === 'warn' ? '#f1c40f' : '#3d4654') + ';padding-left:7px;';
        line.textContent = text;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
    }

    // Allow the popup/background to stop the session remotely.
    chrome.runtime.onMessage.addListener((request) => {
        if (request && request.command === 'autonomousStop') {
            stopRequested = true;
            stopReason = 'stopped from popup';
        }
    });

    // ---- Feed helpers ------------------------------------------------------
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const tweetKey = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 100);

    function getHandle(article) {
        const nameEl = article.querySelector('[data-testid="User-Name"]');
        if (nameEl) {
            const lines = (nameEl.innerText || '').split('\n').map(s => s.trim());
            const h = lines.find(l => l.startsWith('@'));
            if (h) return h;
        }
        return '(unknown)';
    }

    function collectCandidates(seenKeys) {
        const out = [];
        for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
            const rect = article.getBoundingClientRect();
            if (rect.height === 0 && rect.width === 0) continue; // unmounted or hidden by the filter
            const textEl = article.querySelector('[data-testid="tweetText"]');
            if (!textEl) continue;
            const text = (textEl.innerText || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const key = tweetKey(text);
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            out.push({ key: key, handle: getHandle(article), text: text.slice(0, 500) });
        }
        return out;
    }

    function findArticleByKey(key) {
        for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
            const textEl = article.querySelector('[data-testid="tweetText"]');
            if (textEl && tweetKey(textEl.innerText || '') === key) return article;
        }
        return null;
    }

    async function openCaretMenu(article) {
        const caret = article.querySelector('[data-testid="caret"]');
        if (!caret) return null;
        caret.click();
        for (let i = 0; i < 20; i++) { // up to ~2s for the portaled dropdown
            await sleep(100);
            const items = document.querySelectorAll('[role="menuitem"]');
            if (items.length > 0) return Array.from(items);
        }
        return null;
    }

    async function closeAnyMenu() {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(150);
        const mask = document.querySelector('[data-testid="mask"]');
        if (mask) {
            mask.click();
            await sleep(150);
        }
    }

    // Perform 'mute' or 'not_interested' on the tweet identified by item.key.
    async function performAction(item, action) {
        const article = findArticleByKey(item.key);
        if (!article) {
            logLine('Post no longer rendered, skipped: "' + item.text.slice(0, 50) + '..."', 'warn');
            return false;
        }
        article.scrollIntoView({ block: 'center' });
        await sleep(500);

        const menuItems = await openCaretMenu(article);
        if (!menuItems) {
            logLine('Could not open the menu for ' + item.handle + ', skipped.', 'warn');
            stats.errors++;
            return false;
        }

        let target = null;
        for (const mi of menuItems) {
            const label = (mi.innerText || '').trim().toLowerCase();
            // Hard safety line: this agent never blocks or reports anyone.
            if (label.startsWith('block') || label.includes('report')) continue;
            if (action === 'mute' && label.startsWith('mute')) { target = mi; break; }
            if (action === 'not_interested' && label.includes('not interested')) { target = mi; break; }
        }

        if (!target) {
            await closeAnyMenu();
            logLine('Menu item for "' + action + '" not found on ' + item.handle + "'s post, skipped.", 'warn');
            stats.errors++;
            return false;
        }

        target.click();
        await sleep(700);
        await closeAnyMenu(); // no-op if the menu already closed itself
        return true;
    }

    // ---- Main loop ---------------------------------------------------------
    async function run() {
        let cfg = { maxMutes: 5, maxNotInterested: 20, maxTweetsScanned: 150, maxDurationMs: 8 * 60 * 1000, batchSize: 12 };
        try {
            const resp = await chrome.runtime.sendMessage({ command: 'autonomousGetConfig' });
            if (resp && resp.config) cfg = resp.config;
        } catch (e) { /* keep defaults */ }

        buildOverlay();
        logLine('Session started. Caps: ' + cfg.maxMutes + ' mutes, ' + cfg.maxNotInterested +
            ' not-interested, ' + cfg.maxTweetsScanned + ' posts, ' + Math.round(cfg.maxDurationMs / 60000) + ' min.');

        const startedAt = Date.now();
        const seenKeys = new Set();
        const pending = [];
        let emptyScrolls = 0;

        while (!stopRequested) {
            if (Date.now() - startedAt > cfg.maxDurationMs) { stopReason = 'time limit reached'; break; }
            if (stats.scanned >= cfg.maxTweetsScanned) { stopReason = 'post cap reached'; break; }
            if (stats.muted.length >= cfg.maxMutes && stats.notInterested.length >= cfg.maxNotInterested) {
                stopReason = 'both action caps reached'; break;
            }

            const fresh = collectCandidates(seenKeys);
            stats.scanned += fresh.length;
            pending.push(...fresh);

            if (pending.length >= cfg.batchSize || (fresh.length === 0 && pending.length > 0)) {
                const batch = pending.splice(0, cfg.batchSize);
                stats.batches++;
                setStatus('Asking AI about ' + batch.length + ' posts (batch ' + stats.batches + ')...');
                let decisions = [];
                try {
                    const resp = await chrome.runtime.sendMessage({ command: 'autonomousDecide', tweets: batch });
                    if (resp && resp.error) { stopReason = 'AI stopped: ' + resp.error; break; }
                    decisions = (resp && resp.decisions) || [];
                } catch (e) {
                    stopReason = 'lost contact with the extension: ' + e.message;
                    break;
                }

                for (const d of decisions) {
                    if (stopRequested) break;
                    const item = batch[d.index];
                    if (!item || d.action === 'none') continue;
                    const why = d.reason ? ' - ' + d.reason : '';
                    if (d.action === 'mute' && stats.muted.length < cfg.maxMutes) {
                        setStatus('Muting ' + item.handle + '...');
                        if (await performAction(item, 'mute')) {
                            stats.muted.push({ handle: item.handle, text: item.text.slice(0, 120), reason: d.reason || '' });
                            logLine('Muted ' + item.handle + why, 'action');
                        }
                    } else if (d.action === 'not_interested' && stats.notInterested.length < cfg.maxNotInterested) {
                        setStatus('Not interested: ' + item.handle + '...');
                        if (await performAction(item, 'not_interested')) {
                            stats.notInterested.push({ handle: item.handle, text: item.text.slice(0, 120), reason: d.reason || '' });
                            logLine('Not interested: ' + item.handle + why, 'action');
                        }
                    }
                }
            }

            if (fresh.length === 0) {
                emptyScrolls++;
                if (emptyScrolls >= 4 && pending.length === 0) { stopReason = 'feed ran out of new posts'; break; }
            } else {
                emptyScrolls = 0;
            }

            setStatus('Scrolling... ' + stats.scanned + ' posts scanned, ' +
                stats.muted.length + ' muted, ' + stats.notInterested.length + ' not-interested.');
            window.scrollBy(0, Math.round(window.innerHeight * 0.85));
            await sleep(1300);
        }

        finish(stopReason || 'stopped by user');
    }

    function finish(reason) {
        window.__forcefieldAutonomousActive = false;
        const summary = {
            when: Date.now(),
            reason: reason,
            scanned: stats.scanned,
            batches: stats.batches,
            errors: stats.errors,
            muted: stats.muted,
            notInterested: stats.notInterested
        };
        setStatus('Done (' + reason + '): muted ' + stats.muted.length + ', not-interested ' +
            stats.notInterested.length + ', out of ' + stats.scanned + ' posts.');
        logLine('Session finished: ' + reason);
        if (stopBtn) stopBtn.textContent = 'Close';
        try {
            chrome.runtime.sendMessage({ command: 'autonomousDone', summary: summary }).catch(() => {});
        } catch (e) { /* extension context gone; nothing to do */ }
    }

    run().catch((e) => {
        console.error(TAG, 'Session crashed:', e);
        finish('crashed: ' + e.message);
    });
})();
