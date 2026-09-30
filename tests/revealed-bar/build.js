// Builds test pages that run the REAL actualContentBlockingFunction from
// background.js against X-like markup (react-native-web: every div a flex
// column, header/body/actions rows are flex rows).
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.argv[2], 'utf8');
const start = src.indexOf('function actualContentBlockingFunction');
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const fn = src.slice(start, end);
const out = __dirname;

const css = `
html,body{margin:0;background:#fff;font-family:Segoe UI,sans-serif;font-size:15px;color:#0f1419}
div{display:flex;flex-direction:column;box-sizing:border-box;position:relative;min-width:0;min-height:0;flex-shrink:0;align-items:stretch}
.row{flex-direction:row}
#timeline{position:relative;margin:0 auto;border-left:1px solid #eee;border-right:1px solid #eee}
[data-testid=cellInnerDiv]{position:absolute;left:0;right:0;border-bottom:1px solid #eee}
article{display:flex;flex-direction:column;padding:12px 16px 0;cursor:pointer}
.avatar{width:40px;height:40px;border-radius:50%;background:#bbb}
.tt{display:block;white-space:pre-wrap;word-wrap:break-word;line-height:20px}
.act{justify-content:space-between;max-width:425px;margin:12px 0;color:#536471}
.caret{margin-left:auto;color:#536471}
.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function tweet(id, name, handle, textHtml) {
  return `<article data-testid="tweet" role="article" data-post="${id}"><div><div>
<div class="row" data-part="bodyrow">
 <div style="width:40px;margin-right:8px"><div data-testid="Tweet-User-Avatar"><div class="avatar"></div></div></div>
 <div style="flex:1 1 0px">
  <div class="row" data-part="header"><div data-testid="User-Name" class="row name"><div><span style="font-weight:700">${name}</span></div><div class="row" style="color:#536471;margin-left:4px"><div><span>${handle}</span></div><div style="padding:0 4px"><span>·</span></div><div><a href="https://x.com/${handle.slice(1)}/status/${id}"><time>10h</time></a></div></div></div><div class="caret">⋯</div></div>
  <div data-testid="tweetText" class="tt" lang="en">${textHtml}</div>
  <div class="row act" role="group" data-part="actions"><div>💬 3</div><div>🔁 1</div><div>♡ 16</div><div>📊 728</div><div>🔖</div></div>
 </div>
</div></div></div></article>`;
}

const posts = [
  ['Anna K', '@anna', 'Muting is worse for them than blocking, and nobody gets to screenshot it.'],
  ['Autumn C', '@autumn', '<span>I delete so many QTs when I remember this. </span><span>I\'m not about to give someone a career just so I can end it.</span>'],
  ['Beth D', '@beth', 'So shunning it is!'],
  ['Matt E', '@matt', 'Or just go to Blueski, pussy.'],
  ['A very long display name that should truncate nicely', '@longname_handle_here', 'Stop trying to take over the world with bullshit. ' + 'More words to make this wrap across several lines in a narrow column. '.repeat(3)],
  ['Ralphie', '@ralph', 'Depends. Once in a while I come out looking like a dolt and sometimes learn something.'],
];

function page(title, body, script) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${body}
<pre id="results" style="display:none"></pre>
<script>
// chrome.storage stub (the injected function runs in a content-script world).
window.__store = {};
window.chrome = { storage: { local: {
  get(keys, cb) { const r = {}; (Array.isArray(keys)?keys:[keys]).forEach(k => { if (k in __store) r[k] = JSON.parse(JSON.stringify(__store[k])); }); setTimeout(() => cb(r), 0); },
  set(obj, cb) { Object.assign(__store, JSON.parse(JSON.stringify(obj))); cb && setTimeout(cb, 0); }
}}};
// Stand-in for X's own click handling: a bubbling listener that "opens the post".
window.__opened = 0;
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('article')) __opened++; });
${fn}
${script}
</script></body></html>`;
}

function timeline(width, items) {
  let y = 0, html = '';
  items.forEach((t, i) => { html += `<div data-testid="cellInnerDiv" style="transform:translateY(${y}px)" data-cell="${i}"><div><div>${t}</div></div></div>`; y += 0; });
  return `<div id="timeline" style="width:${width}px">${html}</div>`;
}

// Cells are absolutely positioned; lay them out after render like X's virtualizer.
const layoutJs = `
function layout(){ let y=0; document.querySelectorAll('[data-testid=cellInnerDiv]').forEach(c=>{c.style.transform='translateY('+y+'px)'; y+=c.getBoundingClientRect().height;}); document.getElementById('timeline').style.height=y+'px'; }
`;


const cells = posts.map((p, i) => tweet(1000 + i, p[0], p[1], p[2]));
for (const w of [600, 380]) {
  fs.writeFileSync(path.join(out, `suite_${w}.html`), page(`suite ${w}`, timeline(w, cells), layoutJs + fs.readFileSync(path.join(__dirname, 'runner.src.js'), 'utf8')));
}
console.log('built, fn length', fn.length);
