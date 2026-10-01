// Runs after popup.js inside the test page. Writes results to <pre id="__results">.
(async function () {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const results = { pass: 0, fail: 0, failures: [] };
    const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d ? ' :: ' + d : '')); } };
    const scenario = window.__scenario;
    await sleep(400);
    const main = document.getElementById('aiModelSelect');
    const dev = document.getElementById('devAiModelSelect');
    const boxes = [...document.querySelectorAll('.jev-settings')];
    const shown = () => boxes.map(b => getComputedStyle(b).display !== 'none');
    const options = [...main.options].map(o => o.value);

    check(options.includes('jev-latest'), `[${scenario}] Jev is in the AI Model dropdown`, options.join(','));
    check([...dev.options].some(o => o.value === 'jev-latest'), `[${scenario}] Jev is in the Developer AI Model dropdown`);
    check(options.includes('claude-haiku-4-5') && options.includes('claude-sonnet-4-6'), `[${scenario}] text models still listed`);
    check(!document.getElementById('xEngineSelect'), `[${scenario}] old separate Engine on X dropdown is gone`);

    if (scenario === 'haiku') {
        const spend = [...document.querySelectorAll('.spend-by-model')].map(e => e.textContent);
        check(spend.length === 2 && spend.every(t => t.startsWith('By model since ') && t.includes('Jev by TypeSafe: $0.0021 over 30 calls · $0.0003 per 100 tweets (700 tweets)') && t.includes('Claude Haiku 4.5: $0.31 over 42 calls · $0.051 per 100 tweets (610 tweets)')), '[haiku] per-model spend shown, cheapest per tweet first', JSON.stringify(spend));
        check(spend[0].indexOf('Jev') < spend[0].indexOf('Haiku'), '[haiku] Jev listed before Haiku');
        check(main.value === 'claude-haiku-4-5' && shown().every(s => !s), '[haiku] Haiku selected, threshold hidden', main.value + ' ' + shown());
        main.value = 'jev-latest'; main.dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.selectedAiModel === 'jev-latest', '[haiku] choosing Jev saves it', JSON.stringify(__areas.sync));
        check(dev.value === 'jev-latest', '[haiku] developer dropdown follows');
        check(shown().every(s => s), '[haiku] threshold appears when Jev is chosen', String(shown()));
        const t = document.querySelector('.jev-threshold');
        check(t.value === '0.5', '[haiku] threshold defaults to 0.5', t.value);
        t.value = '0.7'; t.dispatchEvent(new Event('change')); await sleep(20);
        check(__areas.sync.jevThreshold === 0.7, '[haiku] threshold saves', String(__areas.sync.jevThreshold));
        check([...document.querySelectorAll('.jev-threshold')].every(i => i.value === '0.7'), '[haiku] both threshold boxes agree');
        t.value = '3'; t.dispatchEvent(new Event('change')); await sleep(20);
        check(__areas.sync.jevThreshold === 0.95 && t.value === '0.95', '[haiku] out-of-range threshold clamped to 0.95', t.value);
        main.value = 'claude-sonnet-4-6'; main.dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.selectedAiModel === 'claude-sonnet-4-6' && shown().every(s => !s), '[haiku] switching away hides the threshold');
        main.value = 'jev-latest'; main.dispatchEvent(new Event('change')); await sleep(50); // leave Jev showing for the screenshot
    }
    if (scenario === 'xengine') {
        check(main.value === 'jev-latest', '[xengine] 2.8.0 "Engine on X = Jev" carries over to the dropdown', main.value);
        check(__areas.sync.selectedAiModel === 'jev-latest' && !('xEngine' in __areas.sync), '[xengine] old setting migrated and removed', JSON.stringify(__areas.sync));
        check(shown().every(s => s), '[xengine] threshold visible');
    }
    if (scenario === 'xengine-llm') {
        check(main.value === 'claude-sonnet-4-6' && !('xEngine' in __areas.sync), '[xengine-llm] Sonnet kept, old setting removed', main.value + ' ' + JSON.stringify(__areas.sync));
    }
    if (scenario === 'jev') {
        check(main.value === 'jev-latest' && dev.value === 'jev-latest', '[jev] saved Jev selection shows in both dropdowns');
        check(document.querySelector('.jev-threshold').value === '0.8', '[jev] saved threshold shown', document.querySelector('.jev-threshold').value);
    }
    const pre = document.createElement('pre');
    pre.id = '__results'; pre.style.display = 'none';
    pre.textContent = JSON.stringify(results);
    document.body.appendChild(pre);
})();
