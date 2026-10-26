// Runs inside out/mutes.html after the real actualContentBlockingFunction.
(function () {
    const results = { pass: 0, fail: 0, failures: [], crashes: [] };
    const check = (c, n, d) => { if (c) results.pass++; else { results.fail++; results.failures.push(n + (d ? ' :: ' + d : '')); } };
    const NOTE = 'Muted by Forcefield: @crank keeps arguing in bad faith (mute 2, 1h 40m left)';
    const muted = [{ handle: '@crank', note: NOTE }, { handle: '@me', note: 'should never show' }];
    const phrase = [{ text: 'partisan dunk phrase', level: 8, source: 'ai_continuous', severity: 5 }];
    const art = i => document.querySelector(`article[data-post="${i}"]`);
    const boxedNote = i => {
        const a = art(i);
        const box = a.matches('[data-hidden-by-forcefield="whiteboxed"]') ? a : a.querySelector('[data-hidden-by-forcefield="whiteboxed"]');
        const n = box && box.querySelector(':scope > [data-forcefield-note]');
        return n ? n.textContent : null;
    };
    const run = (list, mutes, whitebox = true) => {
        try { actualContentBlockingFunction(list, false, whitebox, [], null, mutes); }
        catch (e) { results.crashes.push(String(e && e.stack || e)); results.fail++; }
    };
    const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

    run(phrase, muted);
    check(boxedNote(0) === NOTE + ' - click to reveal', 'muted account: post boxed with the mute note', boxedNote(0));
    check(art(0).dataset.hiddenByForcefield === 'whiteboxed', 'the whole post is boxed');
    check(boxedNote(3) === NOTE + ' - click to reveal', 'handle matched whatever its case', boxedNote(3));
    check(boxedNote(5) === NOTE + ' - click to reveal', 'muted post that also has a flagged phrase shows the mute note', boxedNote(5));
    check(boxedNote(1) === null, 'a post quoting the muted account stays visible', boxedNote(1));
    check(boxedNote(2) === null, 'own posts are never muted, even if listed', boxedNote(2));
    check(boxedNote(4) === 'Blocked by Forcefield (severity 5) - click to reveal', 'phrase blocking unchanged', boxedNote(4));

    // Reveal: only "Hide again", plus how to unmute.
    click(art(0));
    const bar = art(0).querySelector('[data-forcefield-bar]');
    const links = bar ? [...bar.querySelectorAll('span')].map(s => s.textContent) : [];
    check(art(0).dataset.forcefieldRevealed === '1' && !art(0).dataset.hiddenByForcefield, 'click reveals the muted post');
    check(links.join('|') === 'Hide again', 'revealed muted post offers only Hide again (no block verdicts)', links.join('|'));
    check(bar && bar.textContent === 'Hide again · Like one of their posts to unmute', 'and says how to unmute', bar && bar.textContent);
    run(phrase, muted);
    check(art(0).dataset.forcefieldRevealed === '1' && !art(0).dataset.hiddenByForcefield, 'the next blocker run leaves the revealed post shown');
    click(bar.querySelector('span'));
    check(boxedNote(0) === NOTE + ' - click to reveal', 'Hide again re-boxes it with the mute note', boxedNote(0));

    // Mute over (or switched off): mute boxes come off, phrase boxes stay.
    run(phrase, []);
    check(boxedNote(0) === null && boxedNote(3) === null, 'no mutes: the account is shown again');
    check(boxedNote(5) === 'Blocked by Forcefield (severity 5) - click to reveal', 'no mutes: the post with a flagged phrase falls back to the phrase box', boxedNote(5));
    check(boxedNote(4) === 'Blocked by Forcefield (severity 5) - click to reveal', 'phrase box still there');

    // Hide mode: muted posts vanish.
    run(phrase, muted, false);
    check(art(0).style.display === 'none' && art(3).style.display === 'none', 'hide mode: muted posts hidden');
    check(art(1).style.display !== 'none' && art(2).style.display !== 'none', 'hide mode: others shown');
    run([], [], true);
    check(art(0).style.display !== 'none' && boxedNote(0) === null, 'empty run restores everything');
    check(window.__errors.length === 0, 'no page errors', window.__errors.join(' | '));
    document.getElementById('results').textContent = JSON.stringify(results);
})();
