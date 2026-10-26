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
        // Orphaned by an extension reload: chrome.storage would throw
        // "Extension context invalidated". The page needs a refresh to log again.
        try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }
        console.log(`[Forcefield] ${category}${opts && opts.remove ? ' (remove)' : ''}${opts && opts.removeByHandle ? ' (remove by handle)' : ''}:`, info.handle || info.displayName || '(unknown)', '-', (info.text || '').slice(0, 60));
        chrome.storage.local.get([STORAGE_KEY, 'tasteNewChars'], (res) => {
            const store = Object.assign({}, EMPTY, res[STORAGE_KEY] || {});
            const list = store[category] = (store[category] || []);
            const k = keyOf(info);
            const update = { [STORAGE_KEY]: store };

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
                // New-activity counter for the taste summary: the background
                // regenerates the aggregate profile after ~5000 tokens
                // (~20000 chars) of newly recorded likes/mutes/etc.
                update.tasteNewChars = (res.tasteNewChars || 0) +
                    (info.text || '').length + (info.handle || '').length;
            }
            chrome.storage.local.set(update);
        });
    }

    document.addEventListener('click', (e) => {
        // Only record HUMAN actions. The autonomous agent clicks these same
        // menus synthetically (isTrusted=false); letting those into the
        // activity log would feed the AI's own decisions back into prompt
        // personalization as if the user made them.
        if (!e.isTrusted) return;
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

    // --- Temporary mute, in X's own "⋯" menu (rules in goodFaith.js) --------
    // Right after X's "Mute @handle" item, a "Temporary mute @handle (7 days)"
    // item: a copy of X's item with new text and a clock icon, so it looks
    // like part of the menu. Picking it asks the background to mute the
    // account in this browser (their posts get boxed, like a block), logs it
    // as a mute for the taste profile, and closes the menu. The label shows
    // 30 days when picking it again would give 30. The menu renders a moment
    // after the click, so look for it for a short while. Not limited to human
    // clicks: the autonomous agent only picks items starting with "mute".
    const CLOCK_ICON = '<g><path d="M12 1.75C6.34 1.75 1.75 6.34 1.75 12S6.34 22.25 12 22.25 22.25 17.66 22.25 12 17.66 1.75 12 1.75zm0 18.5c-4.56 0-8.25-3.69-8.25-8.25S7.44 3.75 12 3.75s8.25 3.69 8.25 8.25-3.69 8.25-8.25 8.25zM13 6.5h-2v6.04l4.55 2.73 1.03-1.72L13 11.46z"></path></g>';
    function offerTempMute(tries = 0) {
        const muteItem = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')]
            .find(i => /^mute @[A-Za-z0-9_]{1,50}$/i.test((i.innerText || i.textContent || '').trim()));
        if (!muteItem) {
            if (tries < 20) setTimeout(() => offerTempMute(tries + 1), 50);
            return;
        }
        const menu = muteItem.closest('[role="menu"]');
        if (menu.querySelector('[data-forcefield-temp-mute]')) return;
        const handle = '@' + /@([A-Za-z0-9_]+)/.exec(muteItem.innerText || muteItem.textContent)[1];
        try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }
        chrome.runtime.sendMessage({ command: 'tempMuteOffer', handle }, (res) => {
            if (chrome.runtime.lastError || !res || !res.offer) return; // own account, or the background is asleep
            if (!muteItem.isConnected || menu.querySelector('[data-forcefield-temp-mute]')) return;
            muteItem.after(tempMuteItem(muteItem, handle, res.days));
        });
    }
    function tempMuteItem(muteItem, handle, days) {
        const item = muteItem.cloneNode(true); // copies no listeners: X's Mute won't fire
        item.dataset.forcefieldTempMute = '1';
        item.removeAttribute('data-testid');
        const label = `Temporary mute ${handle} (${days} days)`;
        const leaves = [...item.querySelectorAll('*')].filter(el => !el.children.length && el.textContent.trim());
        if (leaves.length) {
            leaves[0].textContent = label;
            leaves.slice(1).forEach(l => { l.textContent = ''; });
        } else {
            item.textContent = label;
        }
        const icon = item.querySelector('svg');
        if (icon) icon.innerHTML = CLOCK_ICON;
        item.addEventListener('mouseenter', () => { item.style.backgroundColor = 'rgba(127, 127, 127, 0.1)'; });
        item.addEventListener('mouseleave', () => { item.style.backgroundColor = ''; });
        item.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }
            chrome.runtime.sendMessage({ command: 'tempMute', handle }, () => { void chrome.runtime.lastError; });
            const fromPost = pendingTweet && (pendingTweet.handle || '').toLowerCase() === handle.toLowerCase();
            record('muted', fromPost ? pendingTweet : { text: '', displayName: '', handle, url: '' });
            // X closes its menus on Escape.
            item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        });
        return item;
    }
    // A post's caret, or the "⋯" on a profile page.
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('[data-testid="caret"], [data-testid="userActions"]')) offerTempMute();
    }, true);

    // --- For good-faith mutes (goodFaith.js) ---------------------------------
    // Followed accounts, from xFollowWatch.js in the page world: stored under
    // local `xFollowing` as { "@handle": true }, followed ones only, so it
    // stays as small as the user's follow list. Batched, because one
    // timeline load names dozens of accounts.
    let pendingFollows = {};
    let followTimer = null;
    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data || !Array.isArray(e.data.forcefieldFollows)) return;
        for (const pair of e.data.forcefieldFollows) {
            if (!Array.isArray(pair) || typeof pair[1] !== 'boolean' || !/^[A-Za-z0-9_]{1,50}$/.test(pair[0])) continue;
            pendingFollows['@' + pair[0].toLowerCase()] = pair[1];
        }
        clearTimeout(followTimer);
        followTimer = setTimeout(flushFollows, 2000);
    });
    function flushFollows() {
        const batch = pendingFollows;
        pendingFollows = {};
        try { if (!chrome.runtime || !chrome.runtime.id) return; } catch (e) { return; }
        chrome.storage.local.get(['xFollowing'], (res) => {
            const store = Object.assign({}, res.xFollowing || {});
            let changed = false;
            for (const h of Object.keys(batch)) {
                if (batch[h] && !store[h]) { store[h] = true; changed = true; }
                else if (!batch[h] && store[h]) { delete store[h]; changed = true; }
            }
            if (changed) chrome.storage.local.set({ xFollowing: store });
        });
    }

    // The user's own handle (local `xOwnHandle`), so their own posts are
    // never judged: X's side nav links to their profile. The nav renders a
    // little after the page, so look again for a while.
    let ownHandle = null;
    function rememberOwnHandle() {
        const a = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        const m = a && /^\/([A-Za-z0-9_]{1,50})$/.exec(a.getAttribute('href') || '');
        if (!m) return false;
        const h = '@' + m[1].toLowerCase();
        if (h !== ownHandle) {
            try { if (!chrome.runtime || !chrome.runtime.id) return true; } catch (e) { return true; }
            ownHandle = h;
            chrome.storage.local.set({ xOwnHandle: h });
        }
        return true;
    }
    let ownTries = 0;
    const ownTimer = setInterval(() => { if (rememberOwnHandle() || ++ownTries > 40) clearInterval(ownTimer); }, 3000);
    rememberOwnHandle();

    console.log('[Forcefield] Twitter activity tracker active.');
})();
