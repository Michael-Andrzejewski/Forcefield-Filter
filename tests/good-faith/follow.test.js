// Followed accounts for the 7-day cap: the real xFollowWatch.js (page world)
// reading follow flags out of X-shaped API replies, and the real
// twitterTracker.js storing them and the user's own handle.
// Usage: node tests/good-faith/follow.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- xFollowWatch.js in a fake page ---
class FakeXHR {
    constructor() { this.listeners = {}; this.responseType = ''; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
}
FakeXHR.prototype.open = function (method, url) { this.url = url; };
FakeXHR.prototype.send = function () { this.sent = true; };
const posted = [];
const fetchReplies = {};
const page = {
    XMLHttpRequest: FakeXHR,
    fetch: async url => { const body = fetchReplies[url]; return { clone: () => ({ text: async () => body }) }; },
    postMessage: (data, origin) => posted.push({ data, origin }),
    location: { origin: 'https://x.com' },
    setTimeout, JSON, String, Array, Set, WeakMap
};
page.window = page;
vm.createContext(page);
vm.runInContext(fs.readFileSync(path.join(root, 'xFollowWatch.js'), 'utf8'), page, { filename: 'xFollowWatch.js' });

const user = (o) => Object.assign({ __typename: 'User' }, o);
const timeline = users => ({ data: { home: { home_timeline_urt: { instructions: [{ entries: users.map(u => ({ content: { itemContent: { tweet_results: { result: { __typename: 'Tweet', core: { user_results: { result: u } }, legacy: { full_text: 'hi' } } } } } })) }] } } } });
function xhrLoad(url, body, responseType = '') {
    const x = new page.XMLHttpRequest();
    x.open('GET', url);
    x.send();
    x.responseType = responseType;
    if (responseType === 'json') x.response = body; else x.responseText = body;
    (x.listeners.load || []).forEach(fn => fn.call(x));
    return x;
}

(async () => {
    {
        const body = JSON.stringify(timeline([
            user({ core: { screen_name: 'Followed1' }, relationship_perspectives: { following: true }, legacy: {} }),
            user({ core: { screen_name: 'Stranger' }, relationship_perspectives: { following: false }, legacy: {} }),
            user({ legacy: { screen_name: 'OldStyle', following: true } }),
            user({ core: { screen_name: 'NoInfo' }, legacy: { followers_count: 5 } })
        ]));
        const x = xhrLoad('https://x.com/i/api/graphql/abc123/HomeTimeline?variables=1', body);
        check(x.sent && x.url.includes('HomeTimeline'), 'the original open and send still run');
        await sleep(20);
        const pairs = posted.length && posted[0].data.forcefieldFollows;
        check(posted.length === 1 && posted[0].origin === 'https://x.com', 'one message to the page origin', posted.length);
        check(JSON.stringify(pairs) === JSON.stringify([['Followed1', true], ['Stranger', false], ['OldStyle', true]]), 'current and legacy follow flags read; users without one skipped', JSON.stringify(pairs));
    }
    {
        posted.length = 0;
        xhrLoad('https://x.com/i/api/1.1/jot/client_event.json', JSON.stringify(timeline([user({ core: { screen_name: 'A' }, relationship_perspectives: { following: true } })])));
        xhrLoad('https://x.com/i/api/graphql/abc/TweetDetail', '{not json');
        xhrLoad('https://x.com/i/api/graphql/abc/Empty', JSON.stringify({ data: {} }));
        await sleep(20);
        check(posted.length === 0, 'non-GraphQL calls, bad JSON and replies without users send nothing', posted.length);
    }
    {
        posted.length = 0;
        xhrLoad('https://x.com/i/api/graphql/abc/UserByScreenName', timeline([user({ core: { screen_name: 'JsonType' }, relationship_perspectives: { following: true } })]), 'json');
        fetchReplies['https://x.com/i/api/graphql/abc/Following'] = JSON.stringify(timeline([user({ core: { screen_name: 'ViaFetch' }, relationship_perspectives: { following: true } })]));
        await page.fetch('https://x.com/i/api/graphql/abc/Following');
        await sleep(30);
        const names = posted.map(p => p.data.forcefieldFollows.map(f => f[0]).join()).join('|');
        check(names === 'JsonType|ViaFetch', 'json responseType and fetch are read too', names);
    }

    // --- twitterTracker.js storing them ---
    const local = {};
    const messageHandlers = [];
    const tracker = {
        console: { log() {} }, setTimeout, clearTimeout, setInterval, clearInterval, Date, JSON, Object, Array,
        chrome: { runtime: { id: 'fake' }, storage: { local: {
            get(keys, cb) { const r = {}; keys.forEach(k => { if (k in local) r[k] = JSON.parse(JSON.stringify(local[k])); }); setTimeout(() => cb(r), 0); },
            set(obj, cb) { Object.assign(local, JSON.parse(JSON.stringify(obj))); cb && setTimeout(cb, 0); }
        } } },
        document: {
            addEventListener() {},
            querySelector: sel => (sel === 'a[data-testid="AppTabBar_Profile_Link"]' ? { getAttribute: () => '/Me_Too' } : null)
        }
    };
    tracker.window = { addEventListener: (type, fn) => { if (type === 'message') messageHandlers.push(fn); } };
    vm.createContext(tracker);
    vm.runInContext(fs.readFileSync(path.join(root, 'twitterTracker.js'), 'utf8'), tracker, { filename: 'twitterTracker.js' });
    await sleep(20);
    check(local.xOwnHandle === '@me_too', 'own handle read from the profile link', local.xOwnHandle);
    const send = (data, source = tracker.window) => messageHandlers.forEach(fn => fn({ source, data }));
    send({ forcefieldFollows: [['Followed1', true], ['Stranger', false], ['bad handle!', true], ['Yes', 'yes'], ['OldStyle', true]] });
    send({ forcefieldFollows: [['Spoof', true]] }, {});
    await sleep(2200);
    check(JSON.stringify(local.xFollowing) === JSON.stringify({ '@followed1': true, '@oldstyle': true }), 'followed accounts stored lower-case; junk and other windows ignored', JSON.stringify(local.xFollowing));
    send({ forcefieldFollows: [['followed1', false]] });
    await sleep(2200);
    check(JSON.stringify(local.xFollowing) === JSON.stringify({ '@oldstyle': true }), 'an unfollow removes the account', JSON.stringify(local.xFollowing));

    console.log(`good-faith follow: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
