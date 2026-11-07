#!/bin/bash
# Seen posts: the node suites, then two pages in headless Chrome (own temp
# profile, never your real one), driven in real time by cdp-run.js: the real
# twitterTracker.js recording posts from X-like markup, and the real
# IndexedDB store.
# Usage: tests/seen-posts/run.sh
D="$(cd "$(dirname "$0")" && pwd)"; W="$(cygpath -m "$D" 2>/dev/null || echo "$D")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
CHROME_W="$(cygpath -w "$CHROME" 2>/dev/null || echo "$CHROME")"
status=0
node "$D/unit.test.js" || status=1
node "$D/flow.test.js" || status=1
node "$D/page.build.js" "$D/../.." >/dev/null || exit 1
for p in recorder store; do
  node "$D/cdp-run.js" "$CHROME_W" "file:///$W/out/$p.html" "$W/out/profile_$p" 90000 > "$D/out/results_$p.json"
  node -e '
    const t=require("fs").readFileSync(process.argv[1],"utf8").trim();
    if(!t){console.log("seen-posts "+process.argv[2]+": NO RESULTS");process.exit(1)}
    const r=JSON.parse(t);
    console.log(`seen-posts ${process.argv[2]}: ${r.pass} passed, ${r.fail} failed`);
    r.crashes.slice(0,3).forEach(c=>console.log("  CRASH",c.split("\n")[0]));
    r.failures.forEach(f=>console.log("  -",f));
    process.exit(r.fail?1:0);
  ' "$D/out/results_$p.json" $p || status=1
done
exit $status
