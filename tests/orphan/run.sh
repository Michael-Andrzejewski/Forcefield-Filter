#!/bin/bash
# Loads the real continuousScan.js into a page with a fake extension runtime,
# then simulates an extension reload and checks the orphaned copy goes quiet.
# Usage: tests/orphan/run.sh [path/to/continuousScan.js]
D="$(cd "$(dirname "$0")" && pwd)"; W="$(cygpath -m "$D" 2>/dev/null || echo "$D")"
CS="${1:-$D/../../continuousScan.js}"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
mkdir -p "$D/out"
node -e '
  const fs=require("fs");
  const page=fs.readFileSync(process.argv[1],"utf8");
  const cs=fs.readFileSync(process.argv[2],"utf8");
  fs.writeFileSync(process.argv[3], page.replace("/*CONTINUOUS_SCAN*/", () => cs));
' "$D/page.src.html" "$CS" "$D/out/page.html"
"$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=30000 --dump-dom "file:///$W/out/page.html" 2>/dev/null > "$D/out/dom.html"
node -e '
  const h=require("fs").readFileSync(process.argv[1],"utf8");
  const m=h.match(/<pre id="results">([\s\S]*?)<\/pre>/);
  if(!m||!m[1]){console.log("orphan: NO RESULTS");process.exit(1)}
  const r=JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
  console.log(`orphan: ${r.pass} passed, ${r.fail} failed`);
  r.failures.forEach(f=>console.log("  -",f));
  process.exit(r.fail?1:0);
' "$D/out/dom.html"
