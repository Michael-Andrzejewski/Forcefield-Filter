#!/bin/bash
# Runs every Forcefield test set. Exit code is non-zero if any fails.
D="$(cd "$(dirname "$0")" && pwd)"
status=0
node "$D/taste-context/test.js" || status=1
node "$D/trigger/test.js" || status=1
node "$D/jev/test.js" || status=1
node "$D/jev/routing.test.js" || status=1
"$D/popup/run.sh" || status=1
"$D/orphan/run.sh" || status=1
"$D/revealed-bar/run.sh" || status=1
[ $status = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $status
