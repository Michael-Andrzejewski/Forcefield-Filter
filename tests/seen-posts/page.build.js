// Builds two test pages for seen posts, run in headless Chrome by run.sh:
//  out/recorder.html  the REAL twitterTracker.js on X-like markup: which posts
//                     it sends, with what author, text, quote, reply target
//                     and reposter, and when (on screen, after scrolling,
//                     after "Show more", not after the switch goes off).
//  out/store.html     the REAL IndexedDB store from seenPosts.js.
// Usage: node page.build.js path/to/repo
const fs = require('fs');
const path = require('path');
const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const src = f => fs.readFileSync(path.join(repo, f), 'utf8').replace(/<\/script>/gi, '<\\/script>');

const css = `
html,body{margin:0;background:#fff;font-family:Segoe UI,sans-serif;font-size:15px}
div{display:flex;flex-direction:column;box-sizing:border-box}
.row{flex-direction:row}
article{display:flex;flex-direction:column;padding:12px 16px;border-bottom:1px solid #eee;width:560px}
.tt{display:block}
.quote{border:1px solid #ccc;border-radius:12px;padding:8px;margin-top:8px}
`;
const name = (display, handle, id) => `<div data-testid="User-Name" class="row"><div><span>${display}</span></div><div class="row"><div><span>${handle}</span></div><div><span>·</span></div><div>${id ? `<a href="/${handle.slice(1)}/status/${id}"><time datetime="2026-11-07T10:00:00.000Z">2h</time></a>` : '<time datetime="2026-11-06T10:00:00.000Z">1d</time>'}</div></div></div>`;
const quote = (display, handle, text) => `<div role="link" tabindex="0" class="quote">${name(display, handle, '')}<div data-testid="tweetText" class="tt">${text}</div></div>`;
const tweet = (id, display, handle, text, { before = '', after = '', top = '', style = '' } = {}) => `<article data-testid="tweet" data-post="${id}" style="${style}">${top}<div class="row"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px"></div><div style="flex:1 1 0px">
${name(display, handle, id)}${before}${text === null ? '<div><img alt="photo" style="width:200px;height:80px;background:#ddd"></div>' : `<div data-testid="tweetText" class="tt">${text}</div>`}${after}
<div class="row" role="group"><div data-testid="like" role="button">♡</div></div></div></div></article>`;

const feed = [
    tweet(101, 'Alice', '@Alice', 'Plain post from Alice about compilers.'),
    tweet(102, 'Bob', '@Bob', 'Bob\'s own words above the quote.', { after: quote('Carol', '@Carol', 'Carol\'s quoted words.') }),
    tweet(103, 'Dave', '@Dave', 'Dave replying to Erin.', { before: '<div><div>Replying to <a href="/erin">@erin</a></div></div>' }),
    tweet(104, 'Frank', '@Frank', 'Frank\'s post that Eve reposted.', { top: '<div><a href="/eve"><span data-testid="socialContext">Eve reposted</span></a></div>' }),
    tweet(105, 'Gina', '@Gina', null),
    '<div style="height:2500px"></div>',
    tweet(106, 'Hank', '@Hank', 'Far below the fold.'),
    '<div style="height:1600px"></div>',
    tweet(107, 'Ivy', '@Ivy', 'A very tall post. '.repeat(3) + '<div style="height:2600px"></div>end', {}),
    '<div style="height:3000px"></div>'
].join('\n');

const fakeChrome = `
window.__sent = [];
window.__errors = [];
window.addEventListener("error", e => window.__errors.push(String(e.message) + " @" + e.lineno));
window.__changeListeners = [];
window.chrome = {
  runtime: { id: 'fake', lastError: undefined,
    sendMessage: (msg, cb) => { if (msg && msg.command === 'recordSeenPosts') window.__sent.push(...msg.posts); if (cb) setTimeout(() => cb({}), 0); } },
  storage: {
    sync: { get: (k, cb) => setTimeout(() => cb({}), 0) },
    local: { get: (k, cb) => setTimeout(() => cb({}), 0), set: () => {} },
    onChanged: { addListener: fn => window.__changeListeners.push(fn) }
  }
};`;

const recorderRunner = `
(async () => {
  const results = { pass: 0, fail: 0, failures: [], crashes: [] };
  const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d !== undefined ? ' :: ' + d : '')); } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const byId = id => window.__sent.filter(p => p.id === String(id));
  try {
    await sleep(2600);
    const ids = () => window.__sent.map(p => p.id).join(',');
    check(window.__errors.length === 0, 'no page errors', window.__errors.join(' | '));
    check(ids() === '101,102,103,104', 'on screen at load: the four text posts, in page order', ids());
    const a = byId(101)[0] || {};
    check(a.handle === '@Alice' && a.name === 'Alice' && a.text === 'Plain post from Alice about compilers.' && a.page === location.pathname && a.time === '2026-11-07T10:00:00.000Z', 'plain post: author, name, text, page, time', JSON.stringify(a));
    const b = byId(102)[0] || {};
    check(b.handle === '@Bob' && b.text === "Bob's own words above the quote." && b.quote && b.quote.handle === '@Carol' && b.quote.text === "Carol's quoted words.", 'quote post: own text and the quote kept apart', JSON.stringify(b));
    const c = byId(103)[0] || {};
    check(c.handle === '@Dave' && JSON.stringify(c.replyTo) === '["@erin"]', 'reply: the account it answers', JSON.stringify(c));
    const d = byId(104)[0] || {};
    check(d.handle === '@Frank' && d.repostedBy === '@eve', 'repost: the author, and who reposted it', JSON.stringify(d));
    check(!byId(105).length, 'a photo post with no text is not sent');
    check(typeof a.y === 'number' && a.y < b.y && b.y < c.y, 'positions top to bottom', [a.y, b.y, c.y].join());

    // "Show more": Alice's text grows.
    document.querySelector('[data-post="101"] [data-testid="tweetText"]').append(' And the rest after Show more.');
    await sleep(2600);
    check(byId(101).length === 2 && byId(101)[1].text.endsWith('And the rest after Show more.'), 'longer text after Show more is sent again', JSON.stringify(byId(101).map(p => p.text)));

    // Scroll down to Hank.
    document.querySelector('[data-post="106"]').scrollIntoView();
    await sleep(2600);
    check(byId(106).length === 1 && byId(106)[0].y > 2500, 'below the fold: sent after scrolling to it, with its page position', JSON.stringify(byId(106)));

    // Ivy's post is taller than the window: sent once it fills half of it.
    const ivy = document.querySelector('[data-post="107"]');
    check(ivy.getBoundingClientRect().height > window.innerHeight * 2, 'test setup: Ivy is taller than two windows', ivy.getBoundingClientRect().height + ' vs ' + window.innerHeight);
    window.scrollTo(0, ivy.getBoundingClientRect().top + window.scrollY + 200);
    await sleep(2600);
    check(byId(107).length === 1, 'a post taller than the window is sent when it fills half of it', ids());

    // X re-renders Alice: same post, nothing new.
    const before = window.__sent.length;
    const first = document.querySelector('[data-post="101"]');
    const copy = first.cloneNode(true);
    first.replaceWith(copy);
    window.scrollTo(0, 0);
    await sleep(2600);
    check(window.__sent.length === before, 're-rendered post is not sent again', window.__sent.slice(before).map(p => p.id).join());

    // The switch goes off: new posts are not sent.
    window.__changeListeners.forEach(fn => fn({ recordSeenPosts: { oldValue: true, newValue: false } }, 'sync'));
    document.querySelector('[data-post="101"]').insertAdjacentHTML('beforebegin', ${JSON.stringify(tweet(108, 'Jo', '@Jo', 'Posted while recording is off.'))});
    await sleep(2600);
    check(!byId(108).length, 'switch off: nothing sent');
    window.__changeListeners.forEach(fn => fn({ recordSeenPosts: { oldValue: false, newValue: true } }, 'sync'));
    document.querySelector('[data-post="108"]').insertAdjacentHTML('beforebegin', ${JSON.stringify(tweet(109, 'Kim', '@Kim', 'Posted after recording is back on.'))});
    await sleep(2600);
    check(byId(109).length === 1, 'switch back on: new posts sent again');
  } catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; }
  const pre = document.createElement('pre'); pre.id = 'results'; pre.textContent = JSON.stringify(results); document.body.appendChild(pre);
})();`;

fs.writeFileSync(path.join(out, 'recorder.html'), `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<script>${fakeChrome}</script><script>${src('twitterTracker.js')}</script></head>
<body><main>${feed}</main><script>${recorderRunner}</script></body></html>`);

const storeRunner = `
(async () => {
  const results = { pass: 0, fail: 0, failures: [], crashes: [] };
  const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d !== undefined ? ' :: ' + d : '')); } };
  try {
    await new Promise(r => { const d = indexedDB.deleteDatabase('forcefield'); d.onsuccess = d.onerror = d.onblocked = () => r(); });
    const S = self.ForcefieldSeenPosts;
    const store = S.makeSeenStore();
    check(!('posts' in store), 'IndexedDB here -> the IndexedDB store');
    const p = (id, h, t) => ({ id: String(id), handle: h, text: t, page: '/home', y: id });
    check(await S.recordSeenPostsInStore(store, [p(1, '@a', 'one'), p(2, '@b', 'two'), p(3, '@c', '')], 1000) === 3, 'three new posts');
    check(await S.recordSeenPostsInStore(store, [p(2, '@b', 'two'), p(4, '@d', 'four'), p(5, '@a', 'five')], 2000) === 2, 'two more');
    check(JSON.stringify(await store.counts()) === JSON.stringify({ total: 5, pending: 4 }), 'counts', JSON.stringify(await store.counts()));
    const two = await store.pendingPosts(2);
    check(two.length === 2 && two.every(x => x.lastSeen === 2000), 'pending: newest sightings first, limited', JSON.stringify(two.map(x => x.key)));
    const all = await store.pendingPosts(50);
    check(all.map(x => x.key).sort().join() === '1,2,4,5', 'every pending post, never the one with no text', all.map(x => x.key).join());
    const { ids } = S.buildRatingRequest(all);
    const num = new Map([...ids].map(([n, k]) => [k, n]));
    await S.applyRatingsToStore(store, all, ids, new Map([[num.get('1'), { faith: 2, sincerity: 3 }], [num.get('5'), { faith: 4, sincerity: 4 }], [num.get('2'), { faith: 9, sincerity: 9 }]]), 'claude-haiku-5-5', 3000);
    const [one, four] = await store.getPosts(['1', '4']);
    check(one.faith === 2 && one.pending === 0 && four.pending === 1 && four.attempts === 1, 'ratings saved; the skipped post waits', JSON.stringify([one, four]));
    check(JSON.stringify(await store.counts()) === JSON.stringify({ total: 5, pending: 1 }), 'one left pending');
    // A second store, as the popup would open it, sees the same data.
    const popup = S.makeIdbSeenStore();
    const accs = await popup.getAccounts(['@a', '@b', '@d']);
    check(accs['@a'] && accs['@a'].posts.length === 2 && accs['@b'] && !accs['@d'], 'accounts readable from a second connection', JSON.stringify(Object.keys(accs)));
    check((await popup.allAccounts()).length === 2 && (await popup.allPosts()).length === 5, 'allAccounts and allPosts');
    check(await popup.trim(3) === 2 && (await popup.counts()).total === 3, 'trim to 3');
    check((await popup.allPosts()).map(x => x.key).sort().join() === '2,4,5', 'the oldest sightings went', (await popup.allPosts()).map(x => x.key).join());
    await popup.deleteAccounts(['@a']);
    check(!(await store.getAccounts(['@a']))['@a'] && (await store.getAccounts(['@b']))['@b'], 'deleteAccounts');
  } catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; }
  const pre = document.createElement('pre'); pre.id = 'results'; pre.textContent = JSON.stringify(results); document.body.appendChild(pre);
})();`;

fs.writeFileSync(path.join(out, 'store.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${src('goodFaith.js')}</script><script>${src('seenPosts.js')}</script><script>${storeRunner}</script></body></html>`);
console.log('built', out);
