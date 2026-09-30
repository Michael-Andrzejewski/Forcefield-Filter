#!/bin/bash
# Runs the real actualContentBlockingFunction from background.js against
# X-like fake posts in headless Chrome (own temp profile, never your real one).
# Usage: tests/revealed-bar/run.sh [path/to/background.js]
D="$(cd "$(dirname "$0")" && pwd)"; W="$(cygpath -m "$D" 2>/dev/null || echo "$D")"
BG="${1:-$D/../../background.js}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
node "$D/build.js" "$BG" >/dev/null || exit 1
mkdir -p "$D/out"
status=0
for w in 600 380; do
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=60000 --window-size=$((w+40)),2400 --dump-dom "file:///$W/suite_$w.html" 2>/dev/null > "$D/out/dom_$w.html"
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=60000 --window-size=$((w+40)),1400 --screenshot="$W/out/shot_$w.png" "file:///$W/suite_$w.html" >/dev/null 2>&1
  node -e '
    const h=require("fs").readFileSync(process.argv[1],"utf8");
    const m=h.match(/<pre id="results"[^>]*>([\s\S]*?)<\/pre>/);
    if(!m||!m[1]){console.log(process.argv[2],"NO RESULTS");process.exit(1)}
    const r=JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
    console.log(`${process.argv[2]}px: ${r.pass} passed, ${r.fail} failed, ${r.crashes.length} crashes`);
    [...new Set(r.crashes)].slice(0,3).forEach(c=>console.log("  CRASH",c.split("\n")[0]));
    r.failures.slice(0,25).forEach(f=>console.log("  -",f));
    process.exit(r.fail?1:0);
  ' "$D/out/dom_$w.html" $w || status=1
done
exit $status
