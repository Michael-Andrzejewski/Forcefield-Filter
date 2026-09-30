
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = { pass: 0, fail: 0, failures: [], crashes: [] };
const TL = document.getElementById('timeline');
const ORIGINAL = TL.innerHTML;
const PHRASES = [...document.querySelectorAll('[data-testid=tweetText]')].map(e => e.textContent.trim());
const HANDLES = [...document.querySelectorAll('[data-testid=User-Name]')].map(e => (e.innerText.split('\n').join(' ').match(/@\w+/) || [''])[0]);

function check(cond, name, detail) {
  if (cond) results.pass++;
  else { results.fail++; if (results.failures.length < 60) results.failures.push(name + (detail ? ' :: ' + detail : '')); }
}
// Stand-in for React: an expando on each text node (like __reactFiber$...)
// and a handler bound directly to each "Show more" (like React's own).
window.__showMore = 0;
function reset() {
  TL.innerHTML = ORIGINAL; window.__store = {}; window.__opened = 0; window.__showMore = 0;
  document.querySelectorAll('[data-testid=tweetText]').forEach(t => { t.__reactFiber$test = { alive: true }; });
  document.querySelectorAll('[data-testid=tweet-text-show-more-link]').forEach(b => b.addEventListener('click', e => { if (e.currentTarget.__reactFiber$test) { __showMore++; e.stopPropagation(); } }));
  document.querySelectorAll('[data-testid=tweet-text-show-more-link]').forEach(b => { b.__reactFiber$test = { alive: true }; });
  layout();
  // Original geometry of every post, for the "reveal must not resize" checks.
  window.__geom = [...document.querySelectorAll('article')].map(a => { const t = a.querySelector('[data-testid=tweetText]').getBoundingClientRect(); return { w: t.width, l: t.left, aw: a.getBoundingClientRect().width }; });
}
function checkReactAlive(p, node, tag) {
  const a = art(p);
  const tt = a.querySelector('[data-testid=tweetText]');
  check(tt === node, tag + ' original text node kept (not rebuilt)');
  check(!!(tt && tt.__reactFiber$test), tag + ' React link on text node intact');
  const before = __showMore;
  const sm = a.querySelector('[data-testid=tweet-text-show-more-link]');
  if (sm) sm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  check(__showMore === before + 1, tag + ' Show more still clickable', `before=${before} after=${__showMore}`);
  check(__opened === 0, tag + ' Show more click did not leak');
}
// Text actually painted on screen: skips text with no rendered area
// (display:none ancestors, or zero font size inside a white box).
function visibleText(el) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let out = '', n;
  while ((n = w.nextNode())) {
    if (!n.textContent.trim()) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter(q => q.width > 0.5 && q.height > 0.5);
    const cs = n.parentElement && getComputedStyle(n.parentElement);
    if (rects.length && cs && cs.color !== 'rgba(0, 0, 0, 0)') out += n.textContent + ' ';
  }
  return out;
}
function scan(items) {
  try { actualContentBlockingFunction(items, false, true); }
  catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; }
  layout();
}
function click(el) { if (!el) { results.fail++; results.failures.length < 60 && results.failures.push('click target missing'); return; } el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); layout(); }
const art = p => document.querySelector(`article[data-post="${1000 + p}"]`);
const boxed = p => { const a = art(p); if (!a) return null; return a.matches('[data-hidden-by-forcefield=whiteboxed]') ? a : a.querySelector('[data-hidden-by-forcefield=whiteboxed]'); };
const bars = () => document.querySelectorAll('[data-forcefield-bar]');
// The line lives inside the post, or directly after it when every
// container inside the post lays out in a row.
function barOf(p) {
  const a = art(p); if (!a) return null;
  const inside = a.querySelector('[data-forcefield-bar]'); if (inside) return inside;
  const next = a.nextElementSibling; return next && next.dataset.forcefieldBar ? next : null;
}
const link = (a, label) => { const b = barOf(+a.dataset.post - 1000); return b && [...b.querySelectorAll('span')].find(s => s.textContent.startsWith(label)); };

function checkBarGeometry(p, tag) {
  const a = art(p);
  const bar = barOf(p);
  check(!!bar, tag + ' bar belongs to this post');
  if (!bar) return;
  const br = bar.getBoundingClientRect();
  const ar = a.getBoundingClientRect();
  // Revealing must never resize or shift the post itself.
  const g = __geom[p], t = a.querySelector('[data-testid=tweetText]').getBoundingClientRect();
  check(Math.abs(t.width - g.w) < 0.5 && Math.abs(t.left - g.l) < 0.5, tag + ' post text keeps its original width and position', `was ${g.l}+${g.w} now ${t.left}+${t.width}`);
  check(Math.abs(ar.width - g.aw) < 0.5, tag + ' post keeps its original width', `was ${g.aw} now ${ar.width}`);
  check(br.left <= t.left + 1 && br.right >= t.right - 1, tag + ' bar spans under the whole text column', `bar ${br.left}-${br.right} text ${t.left}-${t.right}`);
  let maxBottom = -Infinity;
  for (const d of a.querySelectorAll('*')) {
    if (bar.contains(d) || d.contains(bar)) continue; // the line itself, or a container holding it
    const r = d.getBoundingClientRect();
    if (r.width && r.height) maxBottom = Math.max(maxBottom, r.bottom);
  }
  check(br.top >= maxBottom - 1, tag + ' bar sits below all post content', `barTop=${br.top} contentBottom=${maxBottom}`);
  check(br.height <= 24, tag + ' bar is one short line', `h=${br.height}`);
  check(bar.scrollWidth <= bar.clientWidth + 1, tag + ' all three links fit (no clipping)', `scroll=${bar.scrollWidth} client=${bar.clientWidth}`);
  const spans = [...bar.querySelectorAll('span')];
  check(spans.length === 3, tag + ' three links', 'n=' + spans.length);
  const tops = spans.map(s => Math.round(s.getBoundingClientRect().top));
  check(tops.every(t => t === tops[0]), tag + ' links on one line', tops.join(','));
  const tt = a.querySelector('[data-testid=tweetText]');
  if (tt) {
    const tl = tt.getBoundingClientRect().left, sl = spans[0].getBoundingClientRect().left;
    check(Math.abs(tl - sl) <= 1, tag + ' links aligned with post text', `text=${tl} link=${sl}`);
  }
}

async function cycle(p, level, label) {
  const tag = `[${label} post${p} L${level}]`;
  const phrase = PHRASES[p];
  const origText = art(p).textContent;
  const ttNode = art(p).querySelector('[data-testid=tweetText]');
  scan([{ text: phrase, level }]);
  const box = boxed(p);
  check(!!box, tag + ' whiteboxed after scan');
  if (!box) return;
  check(box.textContent.includes('click to reveal'), tag + ' reveal note shown');
  check(!visibleText(art(p)).includes(phrase.slice(0, 15)), tag + ' post text hidden', visibleText(art(p)).slice(0, 80));
  check([...box.children].every(c => c.dataset.forcefieldNote || getComputedStyle(c).display === 'none'), tag + ' only the note is visible in the box');
  check(box.getBoundingClientRect().height >= 36, tag + ' box tall enough for the note');
  for (let q = 0; q < PHRASES.length; q++) if (q !== p) check(!boxed(q), tag + ' other post ' + q + ' untouched');

  click(box.firstElementChild || box);
  check(!boxed(p), tag + ' revealed on click');
  check(art(p).textContent.includes(phrase), tag + ' text restored');
  check(bars().length === 1, tag + ' exactly one bar', 'n=' + bars().length);
  checkBarGeometry(p, tag + ' reveal1');
  checkReactAlive(p, ttNode, tag + ' reveal1');
  check(window.__opened === 0, tag + ' reveal click did not open post', 'opened=' + __opened);

  scan([{ text: phrase, level }]);
  check(!boxed(p), tag + ' rescan leaves revealed post alone');
  check(bars().length === 1, tag + ' rescan keeps one bar', 'n=' + bars().length);

  click(link(art(p), 'Hide again'));
  check(!!boxed(p), tag + ' Hide again re-boxes');
  check(bars().length === 0, tag + ' Hide again removes bar', 'n=' + bars().length);
  check(window.__opened === 0, tag + ' Hide again did not open post');

  click((boxed(p) && (boxed(p).firstElementChild || boxed(p))));
  check(art(p).textContent.replace('Hide again · Good block · Bad block', '') === origText, tag + ' second reveal restores exact text', JSON.stringify(art(p).textContent.slice(-60)));
  checkBarGeometry(p, tag + ' reveal2');
  checkReactAlive(p, ttNode, tag + ' reveal2');

  click(link(art(p), 'Good block'));
  await sleep(15);
  const gb = (__store.twitterActivity || {}).goodBlock || [];
  check(gb.length === 1 && gb[0].handle === HANDLES[p] && gb[0].text.includes(phrase.slice(0, 20)), tag + ' Good block recorded', JSON.stringify(gb).slice(0, 150));
  check(!!boxed(p) && bars().length === 0, tag + ' Good block re-hides');

  click((boxed(p) && (boxed(p).firstElementChild || boxed(p))));
  click(link(art(p), 'Bad block'));
  await sleep(15);
  const st = __store.twitterActivity || {};
  check((st.badBlock || []).length === 1 && (st.goodBlock || []).length === 0, tag + ' Bad block replaces Good block', JSON.stringify(st).slice(0, 150));
  check(!boxed(p) && link(art(p), 'Bad block') && link(art(p), 'Bad block').textContent === 'Bad block (noted)', tag + ' Bad block leaves post shown, marks noted');
  checkBarGeometry(p, tag + ' afterBad');
  checkReactAlive(p, ttNode, tag + ' afterBad');
  scan([{ text: phrase, level }]);
  check(!boxed(p) && bars().length === 1, tag + ' rescan after Bad block keeps it shown');
  checkReactAlive(p, ttNode, tag + ' afterBadRescan');
  check(window.__opened === 0, tag + ' no clicks leaked to X', 'opened=' + __opened);
  check(typeof __store.tasteNewChars === 'number' && __store.tasteNewChars > 0, tag + ' tasteNewChars counted');
}

(async () => {
  layout();
  for (let level = 0; level <= 8; level++) {
    for (let p = 0; p < PHRASES.length; p++) { reset(); await cycle(p, level, document.title); }
  }
  // All posts blocked at once, mixed levels, all revealed: bars must not collide.
  for (let round = 0; round < 3; round++) {
    reset();
    scan(PHRASES.map((t, i) => ({ text: t, level: (i + round) % 7 })));
    for (let p = 0; p < PHRASES.length; p++) { const b = boxed(p); check(!!b, `[all r${round}] post${p} boxed`); if (b) click(b.firstElementChild || b); }
    check(bars().length === PHRASES.length, `[all r${round}] one bar per post`, 'n=' + bars().length);
    for (let p = 0; p < PHRASES.length; p++) checkBarGeometry(p, `[all r${round} post${p}]`);
    scan(PHRASES.map((t, i) => ({ text: t, level: (i + round) % 7 })));
    check(bars().length === PHRASES.length, `[all r${round}] rescan keeps bars`, 'n=' + bars().length);
  }
  // Final visual state for the screenshot: mixed levels, some revealed.
  reset();
  scan(PHRASES.map((t, i) => ({ text: t, level: [0, 2, 0, 2, 3, 5][i] })));
  [0, 1, 3, 4].forEach(p => { const b = boxed(p); if (b) click(b.firstElementChild || b); });
  const b3 = link(art(3), 'Bad block'); if (b3) click(b3);
  layout();
  document.getElementById('results').textContent = JSON.stringify(results);
  document.title = 'DONE';
})();
