// Opens a test page in headless Chrome in real time (not --virtual-time-budget,
// which stops drawing frames after load, so IntersectionObserver never fires
// and IndexedDB never answers), waits for <pre id="results">, prints its
// text, and closes Chrome. Own temp profile, never your real one.
// Usage: node cdp-run.js <chrome.exe> <file:///page.html> <profile dir> [timeout ms]
const { spawn } = require('child_process');
const [chromePath, url, profile, timeoutArg] = process.argv.slice(2);
const timeoutMs = Number(timeoutArg) || 60000;
const port = 9300 + Math.floor(Math.random() * 600);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`, '--window-size=700,1400', url
], { stdio: 'ignore' });

async function json(path) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return r.json();
}

function cdp(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    };
    const opened = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    return {
        opened,
        send: (method, params = {}) => new Promise(resolve => { id += 1; waiting.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); }),
        close: () => ws.close()
    };
}

(async () => {
    const start = Date.now();
    let page = null;
    while (!page && Date.now() - start < 20000) {
        try { page = (await json('/json/list')).find(t => t.type === 'page' && t.url.startsWith('file:')); } catch (e) { /* not up yet */ }
        if (!page) await sleep(250);
    }
    if (!page) { console.log(''); chrome.kill(); process.exit(1); }
    const conn = cdp(page.webSocketDebuggerUrl);
    await conn.opened;
    let text = null;
    while (text === null && Date.now() - start < timeoutMs) {
        const r = await conn.send('Runtime.evaluate', { expression: "(document.getElementById('results') || {}).textContent || null", returnByValue: true });
        text = r.result && r.result.result ? r.result.result.value : null;
        if (text === null) await sleep(300);
    }
    conn.close();
    try {
        const browser = cdp((await json('/json/version')).webSocketDebuggerUrl);
        await browser.opened;
        browser.send('Browser.close');
        await sleep(500);
    } catch (e) { /* already gone */ }
    chrome.kill();
    console.log(text || '');
    process.exit(text ? 0 : 1);
})();
