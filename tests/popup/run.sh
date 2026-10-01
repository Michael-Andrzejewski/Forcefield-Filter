#!/bin/bash
# Loads the real popup.html + llm.js + popup.js in headless Chrome with a fake
# chrome.* API, for several saved-settings scenarios, and checks the AI Model
# dropdown and Jev threshold behaviour. Screenshot: out/popup_haiku.png
D="$(cd "$(dirname "$0")" && pwd)"; W="$(cygpath -m "$D" 2>/dev/null || echo "$D")"
ROOT="$(cygpath -m "$D/../.." 2>/dev/null || echo "$D/../..")"
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
mkdir -p "$D/out"
status=0
for sc in haiku xengine xengine-llm jev; do
  case $sc in
    haiku) seed='{"sync":{"selectedAiModel":"claude-haiku-4-5"},"local":{"aiSpendTotals":{"since":1790800000000,"models":{"claude-haiku-4-5":{"cost":0.31,"calls":42,"tweetCost":0.31,"tweets":610},"jev-latest":{"cost":0.0021,"calls":30,"tweetCost":0.0021,"tweets":700}}}}}' ;;
    xengine) seed='{"sync":{"selectedAiModel":"claude-haiku-4-5","xEngine":"jev"},"local":{}}' ;;
    xengine-llm) seed='{"sync":{"selectedAiModel":"claude-sonnet-4-6","xEngine":"llm"},"local":{}}' ;;
    jev) seed='{"sync":{"selectedAiModel":"jev-latest","jevThreshold":0.8},"local":{}}' ;;
  esac
  node -e '
    const fs=require("fs"); const [root, out, seed, sc, dir]=process.argv.slice(1);
    let h=fs.readFileSync(root+"/popup.html","utf8");
    const head=`<base href="file:///${root}/"><script>window.__seed=${seed};window.__scenario=${JSON.stringify(sc)};</script><script src="file:///${dir}/chrome-stub.js"></script>`;
    h=h.replace(/<head>/i, "<head>"+head);
    h=h.replace(/<\/body>/i, `<script src="file:///${dir}/checks.js"></script></body>`);
    fs.writeFileSync(out, h);
  ' "$ROOT" "$D/out/popup_$sc.html" "$seed" "$sc" "$W"
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=5000 --dump-dom "file:///$W/out/popup_$sc.html" 2>/dev/null > "$D/out/dom_$sc.html"
  [ $sc = haiku ] && "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$W/out/profile" --allow-file-access-from-files --virtual-time-budget=5000 --window-size=420,900 --screenshot="$W/out/popup_haiku.png" "file:///$W/out/popup_$sc.html" >/dev/null 2>&1
  node -e '
    const h=require("fs").readFileSync(process.argv[1],"utf8");
    const m=h.match(/<pre id="__results"[^>]*>([\s\S]*?)<\/pre>/);
    if(!m){console.log("popup "+process.argv[2]+": NO RESULTS");process.exit(1)}
    const r=JSON.parse(m[1].replace(/&quot;/g,"\"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&"));
    console.log(`popup ${process.argv[2]}: ${r.pass} passed, ${r.fail} failed`);
    r.failures.forEach(f=>console.log("  -",f)); process.exit(r.fail?1:0);
  ' "$D/out/dom_$sc.html" $sc || status=1
done
exit $status
