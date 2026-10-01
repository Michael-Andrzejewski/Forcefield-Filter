// Fake chrome.* for loading the real popup.html in a plain page. Storage is
// in memory, seeded from window.__seed; everything else answers harmlessly.
(function () {
    const seed = window.__seed || { sync: {}, local: {} };
    const areas = { sync: Object.assign({}, seed.sync), local: Object.assign({}, seed.local) };
    window.__areas = areas;
    const pick = (area, keys) => {
        const r = {};
        if (keys == null) return Object.assign(r, area);
        (Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys)).forEach(k => { if (k in area) r[k] = area[k]; });
        return r;
    };
    const storageArea = area => ({
        get(keys, cb) { const r = pick(area, keys); if (cb) { setTimeout(() => cb(r), 0); return; } return Promise.resolve(r); },
        set(obj, cb) { Object.assign(area, JSON.parse(JSON.stringify(obj))); if (cb) { setTimeout(cb, 0); return; } return Promise.resolve(); },
        remove(keys, cb) { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete area[k]); if (cb) { setTimeout(cb, 0); return; } return Promise.resolve(); }
    });
    const cbOrPromise = val => (...args) => { const cb = args.find(a => typeof a === 'function'); if (cb) { setTimeout(() => cb(val), 0); return; } return Promise.resolve(val); };
    window.chrome = {
        runtime: { id: 'fake', lastError: undefined, sendMessage: cbOrPromise({}), onMessage: { addListener() {} }, getURL: p => p },
        storage: { sync: storageArea(areas.sync), local: storageArea(areas.local), onChanged: { addListener() {} } },
        tabs: { query: cbOrPromise([]), sendMessage: cbOrPromise({}) },
        scripting: { executeScript: () => Promise.resolve([]) }
    };
    window.alert = () => {};
    window.confirm = () => true;
})();
