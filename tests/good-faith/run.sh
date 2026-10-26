#!/bin/bash
# Good-faith mutes: the node suites, then two pages in headless Chrome (own
# temp profile, never your real one): the real blocker boxing a muted
# account, and the real continuousScan.js naming each tweet's author.
# Usage: tests/good-faith/run.sh
D="$(cd "$(dirname "$0")" && pwd)"; W="$(cygpath -m "$D" 2>/dev/null || echo "$D")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
status=0
node "$D/ledger.test.js" || status=1
node "$D/flow.test.js" || status=1
node "$D/follow.test.js" || status=1
node "$D/page.build.js" "$D/../../background.js" "$D/../../continuousScan.js" >/dev/null || exit 1
for p in mutes authors; do
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=10000 --window-size=700,1400 --dump-dom "file:///$W/out/$p.html" 2>/dev/null > "$D/out/dom_$p.html"
  node -e '
    const h=require("fs").readFileSync(process.argv[1],"utf8");
    const m=h.match(/<pre id="results">([\s\S]*?)<\/pre>/);
    if(!m||!m[1]){console.log("good-faith "+process.argv[2]+": NO RESULTS");process.exit(1)}
    const r=JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
    console.log(`good-faith ${process.argv[2]}: ${r.pass} passed, ${r.fail} failed`);
    r.crashes.slice(0,3).forEach(c=>console.log("  CRASH",c.split("\n")[0]));
    r.failures.forEach(f=>console.log("  -",f));
    process.exit(r.fail?1:0);
  ' "$D/out/dom_$p.html" $p || status=1
done
exit $status
