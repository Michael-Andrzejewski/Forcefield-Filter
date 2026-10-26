// Good-faith mutes: the ladder and ledger rules in goodFaith.js, the
// faith="bad" attribute in llm.js, and Jev's bad-faith question in jev.js.
// Usage: node tests/good-faith/ledger.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d ? ' :: ' + d : '')); } };

const box = { self: {}, console: { log() {}, warn() {} } };
vm.createContext(box);
for (const f of ['llm.js', 'jev.js', 'goodFaith.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), box, { filename: f });
const G = box.self.ForcefieldGoodFaith;
const L = box.self.ForcefieldLLM;
const H = 3600 * 1000, D = 24 * H;
const T0 = Date.parse('2026-10-25T12:00:00Z');

// --- The ladder ---
{
    const got = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => G.muteDurationMs(n) / H).join(',');
    check(got === '1,2,4,8,24,48,96,192,384', 'ladder: 1h 2h 4h 8h, then 1 day doubling', got);
    check([1, 4, 5, 7, 8].map(n => G.formatMuteLength(G.muteDurationMs(n))).join('|') === '1 hour|8 hours|1 day|4 days|8 days', 'ladder lengths read plainly');
    check(G.formatTimeLeft(40 * 60000) === '40m' && G.formatTimeLeft(200 * 60000) === '3h 20m' && G.formatTimeLeft(2 * H) === '2h' && G.formatTimeLeft(52 * H) === '2d 4h' && G.formatTimeLeft(1000) === '1m', 'time left formats');
    check(G.normalizeHandle('@Some_One') === '@some_one' && G.normalizeHandle('Some_One') === '@some_one' && G.normalizeHandle('@a b') === '' && G.normalizeHandle('') === '', 'handles normalize to lower-case @handle');
}

// --- Strikes, mutes and escalation ---
const post = (handle, text) => ({ handle, text });
{
    let r = G.recordBadFaithPosts({}, [post('@Crank', 'first bad faith post here')], { now: T0 });
    check(r.muted.length === 0 && r.ledger['@crank'].posts.length === 1, 'one bad-faith post: counted, no mute yet');
    r = G.recordBadFaithPosts(r.ledger, [post('@crank', 'first bad faith post here')], { now: T0 + 60000 });
    check(r.muted.length === 0 && r.ledger['@crank'].posts.length === 1, 'the same post seen again (X re-render) does not count twice');
    r = G.recordBadFaithPosts(r.ledger, [post('@crank', 'second bad faith post here')], { now: T0 + 2 * 60000 });
    check(r.muted.length === 1 && r.muted[0].n === 1 && r.muted[0].until === T0 + 2 * 60000 + H, 'second post within 30 days: muted 1 hour', JSON.stringify(r.muted));
    let ledger = r.ledger;
    check(G.activeMutes(ledger, {}, T0 + 30 * 60000).map(m => m.handle).join() === '@crank', 'muted half an hour later');
    check(G.activeMutes(ledger, {}, T0 + 2 * H).length === 0, 'mute over after the hour');

    // A bad post seen during the mute is covered by it, and never counts later.
    r = G.recordBadFaithPosts(ledger, [post('@crank', 'third post during the mute')], { now: T0 + 10 * 60000 });
    check(r.muted.length === 0 && r.ledger['@crank'].mutes === 1 && r.ledger['@crank'].posts.length === 0, 'post during a mute: no escalation');
    r = G.recordBadFaithPosts(r.ledger, [post('@crank', 'third post during the mute')], { now: T0 + 3 * H });
    check(r.muted.length === 0, 'that post re-seen after the mute still does not count');

    // After the first mute, one new bad-faith post doubles it, each time.
    ledger = r.ledger;
    let now = T0 + 3 * H;
    const lengths = [];
    for (let i = 0; i < 8; i++) {
        r = G.recordBadFaithPosts(ledger, [post('@crank', 'fresh bad faith post number ' + i)], { now });
        ledger = r.ledger;
        lengths.push(r.muted.length ? (r.muted[0].until - now) / H : 0);
        now = G.muteEnd(ledger['@crank'], false) + 60000; // the next post lands after the mute ends
    }
    check(lengths.join(',') === '2,4,8,24,48,96,192,384', 'each later post after a mute ends: 2h, 4h, 8h, 1d, 2d, 4d, 8d, 16d', lengths.join(','));
    check(ledger['@crank'].mutes === 9, 'nine mutes counted');

    // Followed: same ladder, capped at 7 days.
    const following = { '@crank': true };
    check(G.muteEnd(ledger['@crank'], true) - ledger['@crank'].mutedAt === 7 * D, 'followed account: the 16-day mute stops at 7 days');
    check(G.activeMutes(ledger, following, ledger['@crank'].mutedAt + 7 * D + 60000).length === 0, 'followed account is shown again after 7 days');
    check(G.activeMutes(ledger, {}, ledger['@crank'].mutedAt + 7 * D + 60000).length === 1, 'not followed: still muted after 7 days');
    r = G.recordBadFaithPosts(ledger, [post('@crank', 'one more after the 7 days')], { now: ledger['@crank'].mutedAt + 7 * D + 60000, following });
    check(r.muted.length === 1 && r.muted[0].n === 10 && r.muted[0].until - (ledger['@crank'].mutedAt + 7 * D + 60000) === 7 * D, 'followed: the next mute is 7 days too', JSON.stringify(r.muted));
    check(G.activeMutes(ledger, {}, 0).length === 1 && G.activeMutes(ledger, following, ledger['@crank'].mutedAt + 1).every(m => m.followed), 'activeMutes marks followed accounts');
}

// --- The 30-day window for a first mute, own handle, empty handles ---
{
    let r = G.recordBadFaithPosts({}, [post('@slow', 'a bad faith post long ago')], { now: T0 });
    r = G.recordBadFaithPosts(r.ledger, [post('@slow', 'another bad faith post later')], { now: T0 + 31 * D });
    check(r.muted.length === 0 && r.ledger['@slow'].posts.length === 1, 'two bad posts 31 days apart: no mute');
    r = G.recordBadFaithPosts({}, [post('@Me', 'my own spicy post'), post('@me', 'my other spicy post'), post('', 'no author known here')], { now: T0, ownHandle: '@me' });
    check(Object.keys(r.ledger).length === 0, 'own posts and unknown authors are never counted', JSON.stringify(Object.keys(r.ledger)));
    r = G.recordBadFaithPosts({}, [post('@two', 'first of two in one scan'), post('@two', 'second of two in one scan')], { now: T0 });
    check(r.muted.length === 1 && r.muted[0].handle === '@two', 'two bad-faith posts in one scan mute at once');
}

// --- A like forgives ---
{
    const iso = ms => new Date(ms).toISOString();
    let r = G.recordBadFaithPosts({}, [post('@x', 'bad faith post one'), post('@x', 'bad faith post two')], { now: T0 });
    r = G.recordBadFaithPosts(r.ledger, [post('@y', 'only one bad post by y')], { now: T0 });
    const before = r.ledger;
    let f = G.forgiveLikedAccounts(before, [{ handle: '@X', ts: iso(T0 - D) }, { handle: '@Y', ts: iso(T0 - D) }]);
    check(!f.changed && f.forgiven.length === 0, 'likes from before the record do nothing');
    f = G.forgiveLikedAccounts(before, [{ handle: '@X', ts: iso(T0 + 10 * 60000) }, { handle: '@nobody', ts: iso(T0 + 1) }]);
    check(f.changed && f.forgiven.join() === '@x', 'a like after the mute began forgives that account', JSON.stringify(f.forgiven));
    check(G.activeMutes(f.ledger, {}, T0 + 11 * 60000).length === 0 && f.ledger['@x'].mutes === 0, 'like: unmuted and ladder reset');
    check(before['@x'].mutes === 1, 'forgiveLikedAccounts does not change its input');
    const again = G.forgiveLikedAccounts(f.ledger, [{ handle: '@X', ts: iso(T0 + 10 * 60000) }]);
    check(!again.changed, 'the same like applied twice changes nothing');
    // After the like, the old posts never count again; new ones start fresh.
    r = G.recordBadFaithPosts(f.ledger, [post('@x', 'bad faith post one'), post('@x', 'bad faith post two')], { now: T0 + H });
    check(r.muted.length === 0 && r.ledger['@x'].posts.length === 0, 'after a like, the forgiven posts never count again');
    r = G.recordBadFaithPosts(r.ledger, [post('@x', 'a brand new bad post')], { now: T0 + 2 * H });
    check(r.muted.length === 0 && r.ledger['@x'].posts.length === 1, 'after a like, a new post needs a second one again (ladder reset)');
    // A like between two posts forgives only the earlier one.
    r = G.recordBadFaithPosts({}, [post('@z', 'z bad post one')], { now: T0 });
    f = G.forgiveLikedAccounts(r.ledger, [{ handle: '@z', ts: iso(T0 + 1000) }]);
    r = G.recordBadFaithPosts(f.ledger, [post('@z', 'z bad post two')], { now: T0 + 2000 });
    check(f.forgiven.join() === '@z' && r.muted.length === 0 && r.ledger['@z'].posts.length === 1, 'a like forgives what came before it, not after');
    // A like older than the mute (but newer than the record) leaves it.
    r = G.recordBadFaithPosts({}, [post('@w', 'w one'), post('@w', 'w two')], { now: T0 });
    f = G.forgiveLikedAccounts(r.ledger, [{ handle: '@w', ts: iso(T0 - 1) }]);
    check(!f.changed && G.activeMutes(f.ledger, {}, T0 + 1).length === 1, 'a like older than the mute leaves it in place');
}

// --- Attribution: which tweet a bad-faith phrase came from ---
{
    const tweets = [
        { text: 'Jesus christ, the absolutely dumbest idea anyone has had this year', handle: '@Angry' },
        { text: 'A careful thread on how the proof works, with links', handle: '@kind' },
        { text: 'lol', handle: '@short' },
        { text: 'copypasta that two different accounts both posted today', handle: '@one' },
        { text: 'copypasta that two different accounts both posted today', handle: '@two' }
    ];
    const got = G.attributeBadFaith(['the absolutely dumbest idea anyone has had', 'lol', 'copypasta that two different accounts both posted', 'not in any tweet at all here'], tweets);
    check(got.length === 1 && got[0].handle === '@angry' && got[0].text === tweets[0].text, 'phrase pinned on the one tweet that contains it; short, shared and unknown phrases skipped', JSON.stringify(got));
    const curly = G.attributeBadFaith(['don’t   care what you “think”'], [{ text: "I don't care what you \"think\" about it", handle: '@q' }]);
    check(curly.length === 1 && curly[0].handle === '@q', 'smart quotes and spacing are folded like the blocker does');
    const twice = G.attributeBadFaith(['first bad sentence in it', 'second bad sentence in it'], [{ text: 'first bad sentence in it. second bad sentence in it.', handle: '@a' }]);
    check(twice.length === 1, 'two bad phrases from one tweet count as one post');
}

// --- Popup lines ---
{
    let r = G.recordBadFaithPosts({}, [post('@muted', 'm1'), post('@muted', 'm2'), post('@pending', 'p1')], { now: T0 });
    r = G.recordBadFaithPosts(r.ledger, [post('@followed', 'f1'), post('@followed', 'f2')], { now: T0 - 2 * H });
    const lines = G.describeLedger(r.ledger, { '@followed': true }, T0 + 20 * 60000);
    check(lines.length === 3, 'three accounts listed', JSON.stringify(lines));
    check(lines[0] === '@muted · muted, 40m left (mute 1)', 'muted first, with time left', lines[0]);
    check(lines[1] === '@followed · 1 mute so far; the next bad-faith post mutes for 2 hours · you follow them (7-day cap)', 'ended mute shows the next rung', lines[1]);
    check(lines[2] === '@pending · 1 bad-faith post; 1 more within 30 days mutes for 1 hour', 'pending account shows what is left', lines[2]);
    check(G.muteNote({ handle: '@muted', n: 3, until: T0 + 200 * 60000 }, T0) === 'Muted by Forcefield: @muted keeps arguing in bad faith (mute 3, 3h 20m left)', 'white box note');
}

// --- The ledger stays bounded ---
{
    const posts = [];
    for (let i = 0; i < G.GOOD_FAITH_MAX_ACCOUNTS + 50; i++) posts.push(post('@acct' + i, 'one bad faith post from ' + i));
    let r = G.recordBadFaithPosts({}, [post('@keepme', 'keep one'), post('@keepme', 'keep two')], { now: T0 - D + 1000 });
    r = G.recordBadFaithPosts(r.ledger, posts, { now: T0 });
    const n = Object.keys(r.ledger).length;
    check(n === G.GOOD_FAITH_MAX_ACCOUNTS, 'ledger capped', n);
    check(!!r.ledger['@acct' + (G.GOOD_FAITH_MAX_ACCOUNTS + 49)], 'newest accounts kept');
}

// --- The model's faith attribute (llm.js) ---
{
    const tags = L.extractRatedNegativeTags([
        '<Negative severity="7" faith="bad">a</Negative>',
        "<Negative faith='bad' severity='4'>b</Negative>",
        '<Negative severity="5" faith="good">c</Negative>',
        '<Negative severity="6">d</Negative>',
        '<Negative severity="3" faith=bad>e</Negative>'
    ].join('\n'));
    check(tags.map(t => `${t.text}${t.severity}${t.badFaith ? 'B' : ''}`).join(',') === 'a7B,b4B,c5,d6,e3B', 'faith="bad" parsed in any order and quoting; anything else is not bad faith', JSON.stringify(tags));
    const fi = L.FAITH_INSTRUCTIONS;
    check(/faith="bad"/.test(fi) && /<Negative severity="7" faith="bad">exact text<\/Negative>/.test(fi) && /not bad faith on its own/.test(fi), 'faith instructions give the format and the limits');
    check(!/—/.test(fi), 'no em dashes in the instructions');
}

// --- Jev's bad-faith question (jev.js) ---
{
    const q = (askFaith) => vm.runInContext('buildJevRequest', box)({ tweets: [{ text: 'hi there', handle: '@a' }, { text: 'second', handle: '@b' }], systemPrompt: 'rules', tasteContext: 'taste', askFaith }).questions;
    check(Object.keys(q(false)).join() === 't0,t1', 'without askFaith: only the severity questions');
    const withFaith = q(true);
    check(Object.keys(withFaith).join() === 't0,f0,t1,f1', 'with askFaith: a faith question per tweet', Object.keys(withFaith).join());
    check(withFaith.f1.type === 'score' && withFaith.f1.criteria.length === 2 && /^Good faith/.test(withFaith.f1.criteria[0]) && /^Bad faith/.test(withFaith.f1.criteria[1]) && withFaith.f1.instructions.tweet.author === '@b', 'faith question: two levels, good then bad, with the author');
}

console.log(`good-faith ledger: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
