// twitterTracker.js — logs the user's Like / Not-interested / Mute / Block actions
// on twitter.com / x.com into chrome.storage.local (key: "twitterActivity") so they
// can be viewed in the extension popup.
//
// Runs as a declarative content script on every X/Twitter page, independent of the
// toxicity scanner. Detection relies on Twitter's data-testid attributes, which are
// relatively stable but can change if Twitter reworks its DOM.
(function () {
    if (window.__forcefieldTwitterTrackerInit) return;
    window.__forcefieldTwitterTrackerInit = true;

    const STORAGE_KEY = 'twitterActivity';
    const EMPTY = { liked: [], notInterested: [], muted: [], blocked: [] };

    // The tweet whose "⋯" menu is currently open. The dropdown is portaled out of the
    // tweet's <article>, so we remember the tweet when the caret is clicked and attribute
    // the subsequent menu-item click to it.
    let pendingTweet = null;

    function getArticle(el) {
        return el && el.closest ? el.closest('article[data-testid="tweet"]') : null;
    }

    function extractTweetInfo(article) {
        if (!article) return null;

        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText.trim() : '';

        let displayName = '';
        let handle = '';
        const nameEl = article.querySelector('[data-testid="User-Name"]');
        if (nameEl) {
            const lines = (nameEl.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
            displayName = lines[0] || '';
            handle = lines.find(l => l.startsWith('@')) || '';
        }

        let url = '';
        const timeEl = article.querySelector('a[href*="/status/"] time');
        if (timeEl && timeEl.parentElement && timeEl.parentElement.href) {
            url = timeEl.parentElement.href;
        }

        return { text, displayName, handle, url };
    }

    // Dedup key: permalink if we have it, otherwise handle + a slice of the text.
    function keyOf(info) {
        return info.url || `${info.handle || ''}::${(info.text || '').slice(0, 80)}`;
    }

    const MAX_ENTRIES_PER_CATEGORY = 500; // cap growth; oldest entries drop off

    function record(category, info, opts) {
        if (!info || (!info.text && !info.handle)) return; // nothing identifiable to store
        console.log(`[Forcefield] ${category}${opts && opts.remove ? ' (remove)' : ''}${opts && opts.removeByHandle ? ' (remove by handle)' : ''}:`, info.handle || info.displayName || '(unknown)', '-', (info.text || '').slice(0, 60));
        chrome.storage.local.get([STORAGE_KEY], (res) => {
            const store = Object.assign({}, EMPTY, res[STORAGE_KEY] || {});
            const list = store[category] = (store[category] || []);
            const k = keyOf(info);

            if (opts && opts.removeByHandle) {
                // Un-mute / un-block are account-level: drop every entry from
                // that handle in this category.
                if (!info.handle) return;
                store[category] = list.filter(e => e.handle !== info.handle);
            } else if (opts && opts.remove) {
                store[category] = list.filter(e => keyOf(e) !== k);
            } else if (list.some(e => keyOf(e) === k)) {
                return; // already recorded — skip the write
            } else {
                list.push({
                    text: info.text,
                    displayName: info.displayName,
                    handle: info.handle,
                    url: info.url,
                    ts: new Date().toISOString()
                });
                if (list.length > MAX_ENTRIES_PER_CATEGORY) {
                    store[category] = list.slice(-MAX_ENTRIES_PER_CATEGORY);
                }
            }
            chrome.storage.local.set({ [STORAGE_KEY]: store });
        });
    }

    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target || !target.closest) return;

        // 1. Like / Unlike. At click time the testid is still the pre-action state:
        //    "like" => about to like (record); "unlike" => about to unlike (remove).
        const likeBtn = target.closest('[data-testid="like"], [data-testid="unlike"]');
        if (likeBtn) {
            const info = extractTweetInfo(getArticle(likeBtn));
            if (info) {
                const isLike = likeBtn.getAttribute('data-testid') === 'like';
                record('liked', info, { remove: !isLike });
            }
            return;
        }

        // 2. The "⋯" caret — remember which tweet this menu belongs to.
        const caret = target.closest('[data-testid="caret"]');
        if (caret) {
            pendingTweet = extractTweetInfo(getArticle(caret));
            return;
        }

        // 3. A menu item inside the open dropdown.
        const menuItem = target.closest('[role="menuitem"]');
        if (menuItem && pendingTweet) {
            const label = (menuItem.innerText || '').trim().toLowerCase();
            if (label.includes('not interested')) {
                record('notInterested', pendingTweet);
            } else if (label.startsWith('unmute')) {
                record('muted', pendingTweet, { removeByHandle: true });
            } else if (label.startsWith('unblock')) {
                record('blocked', pendingTweet, { removeByHandle: true });
            } else if (label.startsWith('mute')) {
                record('muted', pendingTweet);
            } else if (label.startsWith('block')) {
                record('blocked', pendingTweet);
            }
        }
    }, true); // capture phase: run before React's bubble handlers / stopPropagation

    // Keyboard "L" like/unlike. X applies it to the focused/selected tweet
    // (j/k navigation moves focus). Read the like button's testid at keydown
    // time to know whether this press likes or unlikes.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'l' && e.key !== 'L') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
            return; // typing, not a shortcut
        }
        const article = getArticle(active);
        if (!article) return;
        const likeBtn = article.querySelector('[data-testid="like"], [data-testid="unlike"]');
        if (!likeBtn) return;
        const info = extractTweetInfo(article);
        if (info) {
            const isLike = likeBtn.getAttribute('data-testid') === 'like';
            record('liked', info, { remove: !isLike });
        }
    }, true);

    console.log('[Forcefield] Twitter activity tracker active.');
})();
