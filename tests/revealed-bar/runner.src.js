
const sleep = ms => new Promise(r => setTimeout(r, ms));
window.__pageErrors = [];
window.addEventListener('error', e => __pageErrors.push(String(e.message)));
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
  // Bad block must stick across X re-rendering the post, and a later
  // Good block must undo it. bgScan() mirrors triggerPageBlock: it runs the
  // blocker with whatever blockList / allowedPosts are actually in storage.
  const bgScan = () => {
    const keys = (__store.allowedPosts || []).flatMap(p => p.keys || []);
    try { actualContentBlockingFunction(__store.blockList || [], false, true, keys); }
    catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; }
    layout();
  };
  const rerender = () => { TL.innerHTML = ORIGINAL; layout(); }; // X rebuilds the posts; storage survives
  const boxedCount = () => PHRASES.filter((_, q) => boxed(q)).length;
  for (const P of [3, 0, 4]) {
    const tag = `[sticky post${P}]`;
    reset();
    __store.blockList = PHRASES.map(t => ({ text: t.slice(0, 40), level: 5, source: 'ai_continuous' }))
      .concat([{ text: 'an unrelated phrase from elsewhere', level: 5, source: 'ai_continuous' }]);
    bgScan();
    check(boxedCount() === PHRASES.length, tag + ' all posts boxed at start', 'n=' + boxedCount());
    click(boxed(P) && (boxed(P).firstElementChild || boxed(P)));
    click(link(art(P), 'Bad block'));
    await sleep(20);
    const bl = __store.blockList || [];
    check(!bl.some(i => PHRASES[P].startsWith(i.text)), tag + ' Bad block removed the matching phrase', JSON.stringify(bl.map(i => i.text.slice(0, 15))));
    check(bl.length === PHRASES.length, tag + ' other phrases kept', 'n=' + bl.length);
    const entry = (__store.allowedPosts || [])[0] || {};
    check((entry.keys || []).some(k => k.startsWith('url:')) && (entry.keys || []).some(k => k.startsWith('text:')), tag + ' post remembered by link and text', JSON.stringify(entry.keys));
    check(!(entry.keys || []).some(k => k.includes('hideagain')), tag + ' key excludes Forcefield\'s own line');

    rerender(); bgScan();
    check(!boxed(P), tag + ' stays shown after X re-renders');
    check(boxedCount() === PHRASES.length - 1, tag + ' other posts still boxed after re-render', 'n=' + boxedCount());

    // The AI flags the same post again later (e.g. after a page refresh).
    __store.blockList = __store.blockList.concat([{ text: PHRASES[P].slice(0, 40), level: 5, source: 'ai_continuous' }]);
    rerender(); bgScan();
    check(!boxed(P), tag + ' stays shown even when the AI re-flags it');

    // Same post on its own page or in another context: different link, same text.
    rerender();
    const a = art(P).querySelector('a[href*="/status/"]'); if (a) a.href = 'https://x.com/other/status/999' + P;
    bgScan();
    check(!boxed(P), tag + ' recognised by its text when the link differs');

    // Change of mind in the same session: Good block restores the phrases.
    __store.blockList = __store.blockList.filter(i => !PHRASES[P].startsWith(i.text)); // drop the re-flag
    rerender(); bgScan();
    const errsBefore = window.__pageErrors.length;
    reset(); // fresh page
    __store.blockList = PHRASES.map(t => ({ text: t.slice(0, 40), level: 5, source: 'ai_continuous' }));
    bgScan();
    click(boxed(P) && (boxed(P).firstElementChild || boxed(P)));
    click(link(art(P), 'Bad block')); await sleep(20);
    click(link(art(P), 'Good block')); await sleep(20);
    check(!(__store.allowedPosts || []).length, tag + ' Good block removes the allow', JSON.stringify(__store.allowedPosts));
    check((__store.blockList || []).some(i => PHRASES[P].startsWith(i.text)), tag + ' Good block restores the removed phrase');
    rerender(); bgScan();
    check(!!boxed(P), tag + ' boxed again after Good block and a re-render');
    check(window.__pageErrors.length === errsBefore, tag + ' no page errors', window.__pageErrors.slice(errsBefore).join(' | '));
  }

  // The white box names the AI's rating, keeps it through Hide again, and
  // drops it when the post is next matched by an unrated entry.
  {
    const note = p => { const b = boxed(p); const n = b && b.querySelector('[data-forcefield-note]'); return n ? n.textContent : null; };
    reset();
    scan([{ text: PHRASES[1], level: 5, severity: 7 }, { text: PHRASES[2], level: 5 }]);
    check(note(1) === 'Blocked by Forcefield (severity 7) - click to reveal', '[severity] rated post shows its rating', note(1));
    check(note(2) === 'Blocked by Forcefield - click to reveal', '[severity] unrated post shows the plain note', note(2));
    click(boxed(1) && (boxed(1).firstElementChild || boxed(1)));
    click(link(art(1), 'Hide again'));
    check(note(1) === 'Blocked by Forcefield (severity 7) - click to reveal', '[severity] Hide again keeps the rating', note(1));
    reset();
    scan([{ text: PHRASES[1], level: 5, severity: 4 }]);
    scan([{ text: PHRASES[1], level: 5 }]);
    check(note(1) === 'Blocked by Forcefield - click to reveal', '[severity] stale rating dropped on an unrated match', note(1));
    scan([]);
    check(!boxed(1), '[severity] empty list (everything below the Hide level) un-boxes the post');
  }

  // Severity debug view: one grey line under each visible post with its
  // rating, "scanned, not flagged", or nothing when it was never scanned.
  {
    const keyOf = p => { const tt = art(p).querySelector('[data-testid=tweetText]'); return (tt.innerText || tt.textContent)
      .replace(/[‘’`´]/g, "'").replace(/[“”„«»]/g, '"').replace(/[–—―−]/g, '-')
      .replace(/…/g, '...').replace(/\s+/g, '').toLowerCase().slice(0, 60); };
    const line = p => { const a = art(p); const l = a && a._forcefieldBadge; return l && l.isConnected ? l : null; };
    const lineText = p => { const l = line(p); return l ? l.textContent : null; };
    const lineCount = () => document.querySelectorAll('[data-forcefield-badge]').length;
    const note = p => { const b = boxed(p); const n = b && b.querySelector('[data-forcefield-note]'); return n ? n.textContent : null; };
    const entries = [
      { text: PHRASES[0].slice(0, 40), level: 5, severity: 7 },
      { text: PHRASES[1].slice(0, 40), level: 5, severity: 2 },
      { text: PHRASES[2].slice(0, 40), level: 5 }
    ];
    const toHide = entries.filter(e => typeof e.severity !== 'number' || e.severity >= 5);
    const view = () => ({ threshold: 5, entries, scannedKeys: [keyOf(3)] });
    const run = (dbg, wb, v) => { try { actualContentBlockingFunction(toHide, dbg, wb, [], v); } catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; } layout(); };

    reset();
    run(false, true, view());
    check(note(0) === 'Blocked by Forcefield (severity 7) - click to reveal' && !line(0), '[sevview] boxed post: rating in the box, no extra line', note(0) + ' / ' + lineText(0));
    check(lineText(1) === 'Forcefield severity 2 · below hide level 5', '[sevview] post below the level shows its rating', lineText(1));
    check(!!boxed(2) && !line(2), '[sevview] unrated boxed post: no line');
    check(lineText(3) === 'Forcefield: scanned, not flagged', '[sevview] scanned post with no match says so', lineText(3));
    check(!line(4), '[sevview] never-scanned post: no line');
    check(lineCount() === 2, '[sevview] exactly two lines on the page', lineCount());
    {
      const a = art(1), l = line(1), g = __geom[1];
      const t = a.querySelector('[data-testid=tweetText]').getBoundingClientRect(), lr = l.getBoundingClientRect();
      check(lr.height <= 24 && lr.top >= t.bottom - 1, '[sevview] the line is one short line below the post text', `h=${lr.height} top=${lr.top} textBottom=${t.bottom}`);
      check(Math.abs(t.width - g.w) < 0.5 && Math.abs(t.left - g.l) < 0.5, '[sevview] post text keeps its width and position', `was ${g.l}+${g.w} now ${t.left}+${t.width}`);
      check(Math.abs(lr.left + parseFloat(getComputedStyle(l).paddingLeft) - t.left) <= 1, '[sevview] line lines up with the post text');
    }
    const kept = line(1);
    run(false, true, view());
    check(line(1) === kept && lineCount() === 2, '[sevview] re-run keeps the same line (no flicker while scrolling)');
    // The lines must not change what the blocker matches or how posts are keyed.
    run(false, true, view());
    check(!!boxed(0) && !!boxed(2) && !boxed(1), '[sevview] blocking unchanged with lines present');

    // Red highlight mode: hidden posts stay visible, so they get lines too.
    run(true, false, view());
    check(lineText(0) === 'Forcefield severity 7 · at or above hide level 5', '[sevview] highlight mode: rating at or above the level', lineText(0));
    check(lineText(2) === 'Forcefield: unrated phrase, hidden at every level', '[sevview] highlight mode: unrated phrase', lineText(2));
    check(lineText(1) === 'Forcefield severity 2 · below hide level 5', '[sevview] highlight mode: below-level post unchanged', lineText(1));

    // Revealed post: its own Hide again line, no rating line.
    run(false, true, view());
    click(boxed(0) && (boxed(0).firstElementChild || boxed(0)));
    run(false, true, view());
    check(!boxed(0) && !line(0) && bars().length === 1, '[sevview] revealed post: links line only', `boxed=${!!boxed(0)} line=${lineText(0)} bars=${bars().length}`);

    // A different level re-labels in place.
    const lowerView = Object.assign(view(), { threshold: 2 });
    try { actualContentBlockingFunction(entries.filter(e => typeof e.severity !== 'number' || e.severity >= 2), false, true, [], lowerView); } catch (e) { results.fail++; }
    layout();
    check(!!boxed(1) && !line(1), '[sevview] level 2: the 2 is boxed now, its line gone');

    // Switched off: every line removed.
    run(false, true, null);
    check(lineCount() === 0, '[sevview] switched off -> no lines', lineCount());
    check(window.__opened === 0, '[sevview] nothing opened a post');
  }

  // Extension reloaded while a post is revealed: verdict links must not
  // throw or write anything (the storage API is gone).
  reset();
  scan([{ text: PHRASES[0], level: 5 }]);
  click(boxed(0) && (boxed(0).firstElementChild || boxed(0)));
  window.__extAlive = false;
  const errsBefore = window.__pageErrors.length;
  click(link(art(0), 'Bad block'));
  await sleep(20);
  check(window.__pageErrors.length === errsBefore, '[reload] verdict click after reload throws nothing', window.__pageErrors.slice(errsBefore).join(' | '));
  check(!(__store.twitterActivity && (__store.twitterActivity.badBlock || []).length), '[reload] verdict after reload writes nothing');
  window.__extAlive = true;

  // Final visual state for the screenshot: mixed levels, some revealed.
  reset();
  scan(PHRASES.map((t, i) => ({ text: t, level: [0, 2, 0, 2, 3, 5][i] })));
  [0, 1, 3, 4].forEach(p => { const b = boxed(p); if (b) click(b.firstElementChild || b); });
  const b3 = link(art(3), 'Bad block'); if (b3) click(b3);
  layout();
  document.getElementById('results').textContent = JSON.stringify(results);
  document.title = 'DONE';
})();
