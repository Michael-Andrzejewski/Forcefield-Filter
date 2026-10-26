// Builds three test pages for good-faith mutes, run in headless Chrome by run.sh:
//  out/mutes.html  the REAL actualContentBlockingFunction from background.js
//                  boxing a muted account's posts on X-like markup.
//  out/authors.html the REAL continuousScan.js reporting each tweet's author,
//                  including a quoted post inside another account's post.
//  out/menu.html   the REAL twitterTracker.js adding Temporary mute to a
//                  fake X "⋯" menu.
// Usage: node page.build.js path/to/background.js path/to/continuousScan.js path/to/twitterTracker.js
const fs = require('fs');
const path = require('path');
const [bgPath, csPath, trackerPath] = process.argv.slice(2);
const bg = fs.readFileSync(bgPath, 'utf8');
const start = bg.indexOf('function actualContentBlockingFunction');
let depth = 0, end = -1;
for (let i = bg.indexOf('{', start); i < bg.length; i++) {
    if (bg[i] === '{') depth++;
    else if (bg[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const blocker = bg.slice(start, end);
const out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });

const css = `
html,body{margin:0;background:#fff;font-family:Segoe UI,sans-serif;font-size:15px}
div{display:flex;flex-direction:column;box-sizing:border-box}
.row{flex-direction:row}
article{display:flex;flex-direction:column;padding:12px 16px;border-bottom:1px solid #eee;width:560px}
.tt{display:block}
.quote{border:1px solid #ccc;border-radius:12px;padding:8px;margin-top:8px}
`;
const name = (display, handle) => `<div data-testid="User-Name" class="row"><div><span>${display}</span></div><div class="row"><div><span>${handle}</span></div><div><span>·</span></div><div><a href="https://x.com/${handle.slice(1)}/status/1"><time>2h</time></a></div></div></div>`;
const quote = (display, handle, text) => `<div role="link" tabindex="0" class="quote">${name(display, handle)}<div data-testid="tweetText" class="tt">${text}</div></div>`;
const tweet = (id, display, handle, text, extra = '') => `<article data-testid="tweet" data-post="${id}"><div><div class="row"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px"></div><div style="flex:1 1 0px">
${name(display, handle)}<div data-testid="tweetText" class="tt">${text}</div>${extra}
<div class="row" role="group"><div data-testid="like" role="button">♡</div></div></div></div></div></article>`;

const posts = [
    tweet(0, 'Crank', '@crank', 'Only an idiot would read the paper that way, nice try.'),
    tweet(1, 'Kind', '@kind', 'Worth reading this reply carefully before dunking on it.', quote('Crank', '@crank', 'Some quoted words from the muted account here.')),
    tweet(2, 'Me', '@Me', 'My own post, which must never be muted on my own feed.'),
    tweet(3, 'Crank Again', '@Crank', 'Another post by the same account, handle in other case.'),
    tweet(4, 'Phrase', '@phrase', 'A post with a partisan dunk phrase that the blocklist hides.'),
    tweet(5, 'Crank', '@crank', 'And a muted post that also has a partisan dunk phrase in it.')
].join('\n');
const nav = '<nav><a data-testid="AppTabBar_Profile_Link" href="/Me">Profile</a></nav>';

fs.writeFileSync(path.join(out, 'mutes.html'), `<!doctype html><html><head><meta charset="utf-8"><title>mutes</title><style>${css}</style></head><body>
${nav}<div id="timeline">${posts}</div><pre id="results"></pre>
<script>
window.chrome = { runtime: { id: 'fakeextensionid' }, storage: { local: { get(k, cb) { setTimeout(() => cb({}), 0); }, set(o, cb) { cb && setTimeout(cb, 0); } } } };
window.__errors = [];
window.addEventListener('error', e => __errors.push(String(e.message)));
${blocker}
</script>
<script>${fs.readFileSync(path.join(__dirname, 'mutes.runner.src.js'), 'utf8')}</script>
</body></html>`);

// The page script asks to scan, then sends what it saw: keep those messages.
fs.writeFileSync(path.join(out, 'authors.html'), `<!doctype html><html><head><meta charset="utf-8"><title>authors</title><style>${css}</style></head><body>
${nav}<div id="timeline">${posts}</div><pre id="results"></pre>
<script>
window.__sent = [];
window.chrome = { runtime: { id: 'fakeextensionid', lastError: undefined,
    sendMessage(msg, cb) { __sent.push(msg); setTimeout(() => cb && cb(msg.command === 'claimScan' ? { start: true } : { accepted: true }), 1); },
    onMessage: { addListener() {} } },
  storage: { local: { get(k, cb) { setTimeout(() => cb({}), 1); } } } };
</script>
<script>${fs.readFileSync(csPath, 'utf8').replace('.test(location.hostname)', ".test('x.com')") /* the page is file://, the script must think it is on X */}</script>
<script>
(async () => {
  await new Promise(r => setTimeout(r, 1500));
  const results = { pass: 0, fail: 0, failures: [], crashes: [] };
  const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d ? ' :: ' + d : '')); } };
  const msg = __sent.find(m => m.command === 'newContentDetected');
  const by = {};
  (msg ? msg.tweets : []).forEach(t => { by[t.text.slice(0, 12)] = t.handle; });
  check(!!msg && msg.tweets.length === 7, 'page sent all seven tweet texts', msg && msg.tweets.length);
  check(by['Worth readin'] === '@kind', 'quoting post: its own author', by['Worth readin']);
  check(by['Some quoted '] === '@crank', 'quoted post: the quoted author, not the quoting one', by['Some quoted ']);
  check(by['Only an idio'] === '@crank' && by['Another post'] === '@Crank', 'plain posts: their authors', JSON.stringify(by));
  document.getElementById('results').textContent = JSON.stringify(results);
})();
</script></body></html>`);
// A stand-in for X's "⋯" menu: opens 40 ms after a caret (or profile ⋯)
// click, closes on Escape, and its own items close it and count the click.
const menuTweet = `<article data-testid="tweet" data-post="9"><div><div class="row"><div data-testid="Tweet-User-Avatar" style="width:40px;height:40px"></div><div style="flex:1 1 0px">
<div class="row">${name('Crank', '@crank')}<div data-testid="caret" role="button" style="margin-left:auto">⋯</div></div><div data-testid="tweetText" class="tt">A post with a menu.</div></div></div></div></article>`;
fs.writeFileSync(path.join(out, 'menu.html'), `<!doctype html><html><head><meta charset="utf-8"><title>menu</title><style>${css}</style></head><body>
${nav}<div id="timeline">${menuTweet}</div><div data-testid="userActions" role="button">⋯ profile</div><div id="layers"></div><pre id="results"></pre>
<script>
window.__sent = []; window.__store = {}; window.__days = 7; window.__menuFor = '@crank'; window.__muteWord = 'Mute';
window.__xClicked = []; window.__escapes = 0; window.__errors = [];
window.addEventListener('error', e => __errors.push(String(e.message)));
window.chrome = { runtime: { id: 'fakeextensionid', lastError: undefined,
    sendMessage(msg, cb) { __sent.push(msg); setTimeout(() => cb && cb(msg.command === 'tempMuteOffer' ? { offer: msg.handle !== '@me', days: __days } : { muted: true }), 1); } },
  storage: { local: {
    get(keys, cb) { const r = {}; keys.forEach(k => { if (k in __store) r[k] = JSON.parse(JSON.stringify(__store[k])); }); setTimeout(() => cb(r), 0); },
    set(obj, cb) { Object.assign(__store, JSON.parse(JSON.stringify(obj))); cb && setTimeout(cb, 0); } } } };
const item = (label, id) => '<div role="menuitem" tabindex="0" data-testid="' + id + '" class="row"><div><svg viewBox="0 0 24 24"><g><path d="M0 0h1"></path></g></svg></div><div><div dir="ltr"><span>' + label + '</span></div></div></div>';
function openMenu() {
  const h = __menuFor;
  document.getElementById('layers').innerHTML = '<div role="menu"><div><div data-testid="Dropdown">' +
    item('Not interested in this post', 'notInterested') + item('Follow ' + h, 'follow') + item(__muteWord + ' ' + h, 'mute') + item('Block ' + h, 'block') + item('Report post', 'report') + '</div></div></div>';
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-testid="caret"], [data-testid="userActions"]')) setTimeout(openMenu, 40);
  const mi = e.target.closest('[role="menuitem"]');
  if (mi) { __xClicked.push(mi.textContent); document.getElementById('layers').innerHTML = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { __escapes++; document.getElementById('layers').innerHTML = ''; } });
</script>
<script>${fs.readFileSync(trackerPath, 'utf8')}</script>
<script>${fs.readFileSync(path.join(__dirname, 'menu.runner.src.js'), 'utf8')}</script>
</body></html>`);
console.log('built');
