// xFollowWatch.js — learns which accounts the user follows on X, so
// good-faith mutes (goodFaith.js) stop at 7 days for followed accounts.
//
// Runs in the page's own JavaScript world (manifest "world": "MAIN") at
// document_start: the follow flags exist only in the data X's app downloads,
// never in the page's HTML. It reads copies of X's own API responses after
// they arrive. It never changes a request or response and never sends
// anything anywhere: it hands [handle, following] pairs to twitterTracker.js
// with window.postMessage, and that script stores the followed ones.
(function () {
    if (window.__forcefieldFollowWatch) return;
    window.__forcefieldFollowWatch = true;

    const API = /\/graphql\//;
    const MAX_RESPONSE_CHARS = 20 * 1024 * 1024;

    // [handle, following] for every user object that states the follow either
    // way. X has moved these fields over the years, so both the current
    // places (core, relationship_perspectives) and the legacy ones are read.
    function followsIn(data) {
        const out = [];
        const seen = new Set();
        const walk = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 80) return;
            if (Array.isArray(node)) { for (const v of node) walk(v, depth + 1); return; }
            if (node.__typename === 'User') {
                const handle = (node.core && node.core.screen_name) || (node.legacy && node.legacy.screen_name);
                const rp = node.relationship_perspectives;
                const following = rp && typeof rp.following === 'boolean' ? rp.following
                    : node.legacy && typeof node.legacy.following === 'boolean' ? node.legacy.following : null;
                if (typeof handle === 'string' && following !== null && !seen.has(handle)) {
                    seen.add(handle);
                    out.push([handle, following]);
                }
            }
            for (const k in node) walk(node[k], depth + 1);
        };
        walk(data, 0);
        return out;
    }

    function reportData(data) {
        try {
            const pairs = followsIn(data);
            if (pairs.length) window.postMessage({ forcefieldFollows: pairs }, location.origin);
        } catch (e) { /* never disturb the page */ }
    }
    function reportText(text) {
        if (typeof text !== 'string' || !text || text.length > MAX_RESPONSE_CHARS) return;
        let data;
        try { data = JSON.parse(text); } catch (e) { return; }
        reportData(data);
    }

    // XMLHttpRequest: remember each request's URL, read the reply on load.
    // setTimeout keeps the parsing out of X's own load handlers.
    const urls = new WeakMap();
    const XHR = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XHR) {
        const open = XHR.open;
        const send = XHR.send;
        XHR.open = function (method, url) {
            try { urls.set(this, String(url)); } catch (e) {}
            return open.apply(this, arguments);
        };
        XHR.send = function () {
            try {
                if (API.test(urls.get(this) || '')) {
                    this.addEventListener('load', function () {
                        try {
                            if (this.responseType === '' || this.responseType === 'text') setTimeout(reportText, 0, this.responseText);
                            else if (this.responseType === 'json') setTimeout(reportData, 0, this.response);
                        } catch (e) {}
                    });
                }
            } catch (e) {}
            return send.apply(this, arguments);
        };
    }

    // fetch: read a clone, so X's own read of the body is untouched.
    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = function (input) {
            const promise = originalFetch.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : String((input && input.url) || input || '');
                if (API.test(url)) {
                    promise.then(res => {
                        try { res.clone().text().then(t => setTimeout(reportText, 0, t), () => {}); } catch (e) {}
                    }, () => {});
                }
            } catch (e) {}
            return promise;
        };
    }
})();
