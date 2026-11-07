// Seen posts: the record, rating and score rules in seenPosts.js, and the
// store in memory (the same methods as the IndexedDB one, which store.html
// checks in Chrome).
// Usage: node tests/seen-posts/unit.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const check = (c, name, d) => { if (c) pass++; else { fail++; console.log('  FAIL', name + (d !== undefined ? ' :: ' + d : '')); } };

const box = { console, self: {}, Date, Math, JSON, Promise, Map, Set };
vm.createContext(box);
for (const f of ['llm.js', 'goodFaith.js', 'seenPosts.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), box, { filename: f });
const S = box.self.ForcefieldSeenPosts;
const J = v => JSON.stringify(v);
const DAY = 24 * 3600 * 1000;

(async () => {
    // --- cleanSeenPost ---
    {
        check(S.cleanSeenPost({ text: 'no author' }) === null, 'no handle -> dropped');
        check(S.cleanSeenPost({ handle: 'not a handle!', text: 'x' }) === null, 'bad handle -> dropped');
        const p = S.cleanSeenPost({ id: '123', handle: '@Crank', name: 'Crank', text: 'hello', page: '/home', y: 10.6, replyTo: ['@Kind', 'junk!'], quote: { handle: 'Other', text: 'quoted' }, repostedBy: '@Eve', extra: 'dropped' });
        check(p.key === '123' && p.handle === '@crank', 'status id is the key; handle lower-cased', J(p));
        check(p.y === 11 && p.page === '/home', 'position rounded, page kept');
        check(J(p.replyTo) === J(['@kind']), 'reply targets normalized, junk dropped', J(p.replyTo));
        check(p.quote.handle === '@other' && p.quote.text === 'quoted', 'quote kept apart', J(p.quote));
        check(p.repostedBy === '@eve' && !('extra' in p), 'reposter kept; unknown fields dropped');
        const q = S.cleanSeenPost({ id: 'abc', handle: 'Someone', text: 'Same  text\nhere' });
        check(q.id === '' && q.key === '@someone|sametexthere', 'no status id -> author + folded text', q.key);
        check(S.cleanSeenPost({ handle: '@x', text: 'a'.repeat(5000) }).text.length === 2000, 'text capped at 2000');
        check(S.cleanSeenPost({ handle: '@x', text: '' }) === null, 'no id and no text -> no key -> dropped');
        check(S.cleanSeenPost({ id: '9', handle: '@x', text: '' }).key === '9', 'id with no text is kept (a photo post)');
    }
    // --- mergeSeenPost ---
    {
        const base = S.cleanSeenPost({ id: '1', handle: '@a', text: 'short text' });
        const m1 = S.mergeSeenPost(undefined, base, 1000);
        check(m1.pending === 1 && m1.seenCount === 1 && m1.firstSeen === 1000 && m1.lastSeen === 1000 && m1.attempts === 0, 'new post: pending, seen once', J(m1));
        const m2 = S.mergeSeenPost(m1, base, 2000);
        check(m2.seenCount === 2 && m2.lastSeen === 2000 && m2.firstSeen === 1000 && m2.pending === 1, 'seen again: count and lastSeen move');
        const rated = Object.assign({}, m2, { faith: 8, sincerity: 7, pending: 0 });
        const longer = S.cleanSeenPost({ id: '1', handle: '@a', text: 'short text, and then the rest after Show more' });
        const m3 = S.mergeSeenPost(rated, longer, 3000);
        check(m3.text === longer.text && m3.pending === 1 && m3.attempts === 0, 'longer text after a rating: rated again', J(m3));
        const m4 = S.mergeSeenPost(rated, base, 3000);
        check(m4.pending === 0 && m4.faith === 8, 'same text after a rating: stays rated');
        const photo = S.mergeSeenPost(undefined, S.cleanSeenPost({ id: '2', handle: '@a', text: '' }), 1);
        check(photo.pending === 0, 'no text -> never pending');
        const filled = S.mergeSeenPost(Object.assign({}, m1, { name: '' }), Object.assign({}, base, { name: 'Ann' }), 5);
        check(filled.name === 'Ann', 'missing fields filled from a later sighting');
    }
    // --- buildRatingRequest ---
    {
        const posts = [
            { key: 'k1', handle: '@b', text: 'second on home', page: '/home', y: 500 },
            { key: 'k2', handle: '@a', text: 'first on home <script>', page: '/home', y: 100 },
            { key: 'k3', handle: '@c', text: 'a reply', page: '/a/status/1', y: 50, replyTo: ['@a'], quote: { handle: '@q', text: 'quoted words' }, repostedBy: '@r' }
        ];
        const { text, ids } = S.buildRatingRequest(posts);
        check(ids.get(1) === 'k2' && ids.get(2) === 'k1' && ids.get(3) === 'k3', 'numbered by page, top to bottom', J([...ids]));
        check(text.indexOf('=== Page /home ===') < text.indexOf('first on home') && text.indexOf('first on home') < text.indexOf('second on home'), 'page heading then posts in order');
        check(text.includes('<post id="3" author="@c" replying_to="@a" reposted_by="@r">'), 'reply and repost attributes', text);
        check(text.includes('[quoting @q: quoted words]'), 'quote shown as context');
        check(!text.includes('<script>') && text.includes('‹script›'), 'angle brackets in post text are defused');
    }
    // --- parseRatings ---
    {
        const r = S.parseRatings('<r id="1" faith="7" sincerity="8"/>\n<r sincerity="2" id="2" faith="1" />\n<r id="3" faith="12" sincerity="0"/>\nnoise <r id="4" faith="x"/> <r id=5 faith=6.6 sincerity=4>');
        check(J(r.get(1)) === J({ faith: 7, sincerity: 8 }), 'plain line');
        check(J(r.get(2)) === J({ faith: 1, sincerity: 2 }), 'attributes in any order');
        check(J(r.get(3)) === J({ faith: 10, sincerity: 1 }), 'clamped to 1-10');
        check(!r.has(4), 'unreadable line skipped');
        check(J(r.get(5)) === J({ faith: 7, sincerity: 4 }), 'unquoted and decimal values rounded');
        check(S.parseRatings('').size === 0 && S.parseRatings(null).size === 0, 'empty reply -> nothing');
    }
    // --- accounts and scores ---
    const now = 100 * DAY;
    const ratedPost = (k, f, s, ts, h = '@t') => ({ key: k, handle: h, faith: f, sincerity: s, firstSeen: ts });
    {
        let acc = S.addRatingsToAccounts({}, [1, 2, 3, 4].map(i => ratedPost('k' + i, 2, 2, now - i * 1000)), now)['@t'];
        check(acc.posts.length === 4 && acc.posts[0].ts < acc.posts[3].ts, 'posts sorted oldest first');
        check(J(S.accountScore(acc, now)) === J({ score: null, mean: 2, n: 4 }), 'under 5 posts -> no score yet', J(S.accountScore(acc, now)));
        acc = S.addRatingsToAccounts({ '@t': acc }, [ratedPost('k5', 2, 2, now)], now)['@t'];
        check(J(S.accountScore(acc, now)) === J({ score: 3.9, mean: 2, n: 5 }), '5 posts of 2: (10 + 7*3) / 8 = 3.9', J(S.accountScore(acc, now)));
        acc = S.addRatingsToAccounts({ '@t': acc }, [ratedPost('k5', 9, 9, now)], now)['@t'];
        check(acc.posts.length === 5 && acc.posts.find(p => p.k === 'k5').f === 9, 'a re-rated post replaces its old rating');
        const many = S.addRatingsToAccounts({}, Array.from({ length: 60 }, (_, i) => ratedPost('m' + i, 5, 5, now - (60 - i) * 1000)), now)['@t'];
        check(many.posts.length === 50 && many.posts[0].k === 'm10', 'keeps the 50 most recent');
        const old = S.addRatingsToAccounts({}, [ratedPost('o', 1, 1, now - 91 * DAY), ratedPost('n', 1, 1, now)], now)['@t'];
        check(old.posts.length === 1 && old.posts[0].k === 'n', 'posts older than 90 days drop out');
        const forgiven = Object.assign({}, acc, { forgivenAt: now - 2500 });
        check(S.accountScore(forgiven, now).n === 3, 'posts seen before the like stop counting (3 of 5 came after)', J(S.accountScore(forgiven, now)));
        const f = S.forgiveScoredAccounts({ '@t': acc }, [{ handle: '@T', ts: new Date(now - 2500).toISOString() }, { handle: '@nobody', ts: new Date(now).toISOString() }]);
        check(Object.keys(f).join() === '@t' && f['@t'].forgivenAt === now - 2500, 'a like sets forgivenAt; unknown accounts ignored', J(Object.keys(f)));
        check(Object.keys(S.forgiveScoredAccounts(f, [{ handle: '@t', ts: new Date(now - 9000).toISOString() }])).length === 0, 'an older like changes nothing');
        const idx = S.scoreIndex([acc, many, old], now);
        check(J(idx) === J({ '@t': [S.accountScore(acc, now).score, 5] }) || Object.keys(idx).length === 1, 'index has accounts with a score only', J(idx));
    }
    // --- thresholds and mutes ---
    {
        check(S.scoreThresholdFrom(undefined) === 4 && S.scoreThresholdFrom('junk') === 4, 'default 4');
        check(S.scoreThresholdFrom(0) === 1 && S.scoreThresholdFrom(9) === 7, 'clamped to 1-7');
        check(S.scoreThresholdFrom('4.3') === 4.5 && S.scoreThresholdFrom(2.2) === 2, 'half steps');
        const idx = { '@a': [3.5, 9], '@b': [4, 5], '@c': [4.1, 30], '@f': [1, 9], '@me': [2, 9] };
        const muted = S.scoreMutedAccounts(idx, { following: { '@f': true }, ownHandle: '@Me' });
        check(muted.map(m => m.handle).join() === '@a,@b', 'at or below 4, lowest first; followed and own left out', J(muted));
        check(S.scoreMuteNote(muted[0]) === 'Muted by Forcefield: @a averages 3.5/10 for good faith and sincerity over 9 posts', 'note');
        check(S.scoreMutedAccounts(idx, { threshold: 1 }).map(m => m.handle).join() === '@f', 'level 1 without follows: only the 1');
        check(S.scoreMutedAccounts(undefined, {}).length === 0, 'no index -> nobody');
    }
    // --- the store, in memory ---
    {
        const store = S.makeSeenStore();
        check(typeof store.posts === 'object', 'no IndexedDB here -> the memory store');
        const posts = [
            { id: '1', handle: '@a', text: 'one' }, { id: '1', handle: '@a', text: 'one' },
            { id: '2', handle: '@b', text: 'two' }, { id: '3', handle: '@c', text: '' }, { handle: 'bad!', text: 'x' }
        ];
        check(await S.recordSeenPostsInStore(store, posts, 1000) === 3, 'three new posts (one duplicate, one bad)');
        check(await S.recordSeenPostsInStore(store, [{ id: '2', handle: '@b', text: 'two' }, { id: '4', handle: '@d', text: 'four' }], 2000) === 1, 'one more new');
        check(J(await store.counts()) === J({ total: 4, pending: 3 }), 'counts', J(await store.counts()));
        const pend = await store.pendingPosts(2);
        check(pend.map(p => p.key).join() === '2,4' || pend.map(p => p.key).join() === '4,2', 'newest sightings first, limited', pend.map(p => p.key).join());
        const all = await store.pendingPosts(10);
        const { ids } = S.buildRatingRequest(all);
        const keyToNum = new Map([...ids].map(([n, k]) => [k, n]));
        const reply = new Map([[keyToNum.get('1'), { faith: 3, sincerity: 4 }], [keyToNum.get('2'), { faith: 8, sincerity: 8 }]]);
        const rated = await S.applyRatingsToStore(store, all, ids, reply, 'claude-haiku-5-5', 3000);
        check(rated.map(p => p.key).sort().join() === '1,2', 'two rated');
        const [p1, p4] = await store.getPosts(['1', '4']);
        check(p1.faith === 3 && p1.sincerity === 4 && p1.pending === 0 && p1.model === 'claude-haiku-5-5' && p1.ratedAt === 3000, 'rating saved on the post', J(p1));
        check(p4.pending === 1 && p4.attempts === 1, 'left out of the reply: still pending, one attempt', J(p4));
        const accs = await store.getAccounts(['@a', '@b', '@d']);
        check(accs['@a'].posts.length === 1 && accs['@a'].posts[0].f === 3 && accs['@b'] && !accs['@d'], 'accounts updated for rated posts only', J(accs));
        for (let i = 0; i < 2; i++) {
            const again = await store.pendingPosts(10);
            const r = S.buildRatingRequest(again);
            await S.applyRatingsToStore(store, again, r.ids, new Map(), 'm', 4000 + i);
        }
        const [gaveUp] = await store.getPosts(['4']);
        check(gaveUp.pending === 0 && gaveUp.attempts === 3 && !gaveUp.faith, 'after 3 tries it stops asking', J(gaveUp));
        check(await store.trim(2) === 2 && (await store.counts()).total === 2, 'trim keeps the most recently seen');
        const left = (await store.allPosts()).map(p => p.key).sort().join();
        check(left === '2,4', 'the oldest sightings went first', left);
        await store.deleteAccounts(['@a']);
        check(!(await store.getAccounts(['@a']))['@a'], 'deleteAccounts');
    }
    // --- the prompt ---
    {
        const p = S.RATING_SYSTEM_PROMPT;
        check(/Good faith:/.test(p) && /Sincerity:/.test(p) && p.includes('<r id="1" faith="7" sincerity="8"/>'), 'prompt defines both scales and the reply form');
        check(!/[—–]/.test(p), 'no dashes in the prompt that would read as em-dashes');
    }
    console.log(`seen-posts unit: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
