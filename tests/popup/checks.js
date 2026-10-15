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
        check(main.value === 'claude-haiku-4-5' && shown().every(s => !s), '[haiku] Haiku selected, Jev note hidden', main.value + ' ' + shown());
        main.value = 'jev-latest'; main.dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.selectedAiModel === 'jev-latest', '[haiku] choosing Jev saves it', JSON.stringify(__areas.sync));
        check(dev.value === 'jev-latest', '[haiku] developer dropdown follows');
        check(shown().every(s => s), '[haiku] Jev note appears when Jev is chosen', String(shown()));
        check(!document.querySelector('.jev-threshold'), '[haiku] old 0-1 Jev threshold box is gone');
        main.value = 'claude-sonnet-4-6'; main.dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.selectedAiModel === 'claude-sonnet-4-6' && shown().every(s => !s), '[haiku] switching away hides the Jev note');

        // Hide level slider: one in Simple mode, one in Developer mode.
        const sliders = [...document.querySelectorAll('.hide-threshold')];
        const labels = () => [...document.querySelectorAll('.hide-threshold-label')].map(l => l.textContent);
        const badges = () => [...document.querySelectorAll('#blockList .tag-severity')].map(b => b.textContent + (b.classList.contains('below-level') ? '-' : '+')).join(',');
        check(sliders.length === 2 && sliders.every(s => s.type === 'range' && s.min === '1' && s.max === '10'), '[haiku] two 1-10 sliders', sliders.length);
        check(sliders.every(s => s.value === '3'), '[haiku] no saved level -> 3', sliders.map(s => s.value).join(','));
        check(labels().every(t => t === 'Hides 3-10: clearly unwanted and worse. Shows 1-2.'), '[haiku] label for 3', JSON.stringify(labels()));
        check(badges() === '2-,6+', '[haiku] blocklist shows ratings, the 2 greyed at level 3, unrated entry has no badge', badges());
        sliders[0].value = '8'; sliders[0].dispatchEvent(new Event('input')); await sleep(20);
        check(labels().every(t => t === 'Hides 8-10: hostile and worse. Shows 1-7.') && !('hideThreshold' in __areas.sync), '[haiku] dragging updates the text but saves nothing yet', JSON.stringify(labels()));
        sliders[0].dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.hideThreshold === 8, '[haiku] releasing saves the level', String(__areas.sync.hideThreshold));
        check(sliders.every(s => s.value === '8'), '[haiku] both sliders agree', sliders.map(s => s.value).join(','));
        check(badges() === '2-,6-', '[haiku] the 6 greys out at level 8', badges());
        sliders[1].value = '1'; sliders[1].dispatchEvent(new Event('change')); await sleep(50);
        check(__areas.sync.hideThreshold === 1 && sliders[0].value === '1' && labels()[0] === 'Hides everything flagged, even mildly unwanted posts.', '[haiku] developer slider drives the simple one', labels()[0]);
        check(badges() === '2+,6+', '[haiku] nothing greyed at level 1', badges());
        // Severity debug view checkbox: one under each slider, saved locally.
        const dbg = [...document.querySelectorAll('.severity-debug')];
        check(dbg.length === 2 && dbg.every(b => b.type === 'checkbox' && !b.checked), '[haiku] two severity debug checkboxes, off by default', dbg.length);
        dbg[1].checked = true; dbg[1].dispatchEvent(new Event('change')); await sleep(20);
        check(__areas.local.severityDebug === true && dbg[0].checked, '[haiku] ticking either saves it and ticks both', JSON.stringify(__areas.local.severityDebug));
        dbg[0].checked = false; dbg[0].dispatchEvent(new Event('change')); await sleep(20);
        check(__areas.local.severityDebug === false && !dbg[1].checked, '[haiku] unticking saves off');
        dbg[0].checked = true; dbg[0].dispatchEvent(new Event('change')); await sleep(20); // on, for the screenshot
        sliders[0].value = '9'; sliders[0].dispatchEvent(new Event('change')); await sleep(50); // a relaxed day, for the screenshot
        main.value = 'jev-latest'; main.dispatchEvent(new Event('change')); await sleep(50); // leave Jev showing for the screenshot
    }
    if (scenario === 'xengine') {
        check(main.value === 'jev-latest', '[xengine] 2.8.0 "Engine on X = Jev" carries over to the dropdown', main.value);
        check(__areas.sync.selectedAiModel === 'jev-latest' && !('xEngine' in __areas.sync), '[xengine] old setting migrated and removed', JSON.stringify(__areas.sync));
        check(shown().every(s => s), '[xengine] Jev note visible');
    }
    if (scenario === 'xengine-llm') {
        check(main.value === 'claude-sonnet-4-6' && !('xEngine' in __areas.sync), '[xengine-llm] Sonnet kept, old setting removed', main.value + ' ' + JSON.stringify(__areas.sync));
    }
    if (scenario === 'jev') {
        check(main.value === 'jev-latest' && dev.value === 'jev-latest', '[jev] saved Jev selection shows in both dropdowns');
        const sliders = [...document.querySelectorAll('.hide-threshold')];
        check(sliders.every(s => s.value === '9'), '[jev] saved hide level shown', sliders.map(s => s.value).join(','));
        check([...document.querySelectorAll('.severity-debug')].every(b => b.checked), '[jev] saved debug view shown ticked');
        check(document.querySelector('.hide-threshold-label').textContent === 'Hides 9-10: genuinely hateful only. Shows 1-8.', '[jev] label for 9', document.querySelector('.hide-threshold-label').textContent);
    }
    const pre = document.createElement('pre');
    pre.id = '__results'; pre.style.display = 'none';
    pre.textContent = JSON.stringify(results);
    document.body.appendChild(pre);
})();
