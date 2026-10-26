// Runs inside out/menu.html after the real twitterTracker.js.
(async function () {
    const results = { pass: 0, fail: 0, failures: [], crashes: [] };
    const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d ? ' :: ' + d : '')); } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const ours = () => document.querySelectorAll('[data-forcefield-temp-mute]');
    const caret = document.querySelector('[data-testid="caret"]');
    try {
        caret.click();
        await sleep(400);
        let item = ours()[0];
        check(ours().length === 1, 'one Temporary mute item added', ours().length);
        check(item && item.previousElementSibling && item.previousElementSibling.textContent === 'Mute @crank', 'it sits right after X\'s Mute', item && item.previousElementSibling && item.previousElementSibling.textContent);
        check(item && item.textContent === 'Temporary mute @crank (7 days)', 'label names the account and the length', item && item.textContent);
        check(item && item.getAttribute('role') === 'menuitem' && !item.hasAttribute('data-testid'), 'a menu item, without X\'s Mute test id');
        check(item && item.querySelector('svg path').getAttribute('d').startsWith('M12 1.75'), 'clock icon in place of the mute icon');
        check(document.querySelector('[data-testid="mute"]').textContent === 'Mute @crank', 'X\'s own Mute untouched');
        await sleep(1200);
        check(ours().length === 1, 'still just one after the search ends');

        item.click();
        await sleep(50);
        const sent = __sent.filter(m => m.command === 'tempMute');
        check(sent.length === 1 && sent[0].handle === '@crank', 'picking it asks the background to mute @crank', JSON.stringify(sent));
        check(__xClicked.length === 0, 'X\'s own menu handler never saw the click (so X\'s Mute did not fire)', JSON.stringify(__xClicked));
        check(__escapes === 1 && !document.querySelector('[role="menu"]'), 'menu closed with Escape');
        const muted = (__store.twitterActivity && __store.twitterActivity.muted) || [];
        check(muted.length === 1 && muted[0].handle === '@crank', 'logged as a mute for the taste profile', JSON.stringify(muted));

        // Picking again would give 30 days: the label says so.
        __days = 30;
        caret.click();
        await sleep(400);
        check(ours().length === 1 && ours()[0].textContent === 'Temporary mute @crank (30 days)', 'label shows 30 days when that is what it would give', ours()[0] && ours()[0].textContent);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // An account already muted on X: X shows Unmute, so no item.
        __muteWord = 'Unmute';
        caret.click();
        await sleep(1300);
        check(document.querySelector('[role="menu"]') && ours().length === 0, 'no item next to Unmute');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        __muteWord = 'Mute';

        // Your own account: the background declines.
        __menuFor = '@me';
        caret.click();
        await sleep(400);
        check(ours().length === 0, 'no item for your own account');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        // The profile page's own menu.
        __menuFor = '@profileguy'; __days = 7;
        document.querySelector('[data-testid="userActions"]').click();
        await sleep(400);
        check(ours().length === 1 && ours()[0].textContent === 'Temporary mute @profileguy (7 days)', 'profile page menu gets it too', ours()[0] && ours()[0].textContent);
    } catch (e) {
        results.crashes.push(String(e && e.stack || e));
        results.fail++;
    }
    check(__errors.length === 0, 'no page errors', __errors.join(' | '));
    document.getElementById('results').textContent = JSON.stringify(results);
})();
