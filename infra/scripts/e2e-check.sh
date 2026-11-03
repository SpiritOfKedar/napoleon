#!/bin/sh
# End-to-end check against a running stack:
#   upload the sample -> wait for INDEXED -> search for a spoken phrase -> check the top hit.
# Usage: sh infra/scripts/e2e-check.sh [api-url]   (default http://localhost:8080/api)
set -eu

API="${1:-${API_URL:-http://localhost:8080/api}}"
SAMPLE="$(dirname "$0")/../sample/sample-meeting.wav"
QUERY="Q3 budget marketing spending"
# When the Q3 budget sentence starts in the sample (see infra/sample/sample-meeting.json).
EXPECTED_SEC="${EXPECTED_SEC:-31.66}"
TOLERANCE_SEC="${TOLERANCE_SEC:-5}"

json_field() { sed -n "s/.*\"$1\":\([^,}]*\).*/\1/p" | head -1 | tr -d '"'; }

echo "Uploading sample to $API ..."
ID=$(curl -fsS -F "file=@$SAMPLE;filename=e2e-$(date +%s).wav" "$API/media" | json_field id)
echo "Media id: $ID"

for i in $(seq 1 180); do
  STATUS=$(curl -fsS "$API/media/$ID" | json_field status)
  [ "$STATUS" = "INDEXED" ] && break
  if [ "$STATUS" = "FAILED" ]; then
    echo "FAILED: $(curl -fsS "$API/media/$ID")" >&2; exit 1
  fi
  sleep 2
done
[ "$STATUS" = "INDEXED" ] || { echo "Timed out waiting for INDEXED (last: $STATUS)" >&2; exit 1; }
echo "Indexed."

TOP=$(curl -fsS -G "$API/search" --data-urlencode "q=$QUERY" --data "mediaId=$ID" --data "limit=1")
echo "Top hit: $TOP"
START=$(echo "$TOP" | json_field startSec)
echo "$TOP" | grep -qi "budget" || { echo "Top hit does not mention the budget" >&2; exit 1; }

# startSec is the best-matching sentence inside the top chunk; it must be near where the phrase is spoken.
awk -v s="$START" -v e="$EXPECTED_SEC" -v t="$TOLERANCE_SEC" 'BEGIN { d = s - e; if (d < 0) d = -d; exit !(d <= t) }' \
  || { echo "Top hit starts at ${START}s, expected about ${EXPECTED_SEC}s" >&2; exit 1; }

RANGE=$(curl -fsS -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" "$API/media/$ID/stream")
[ "$RANGE" = "206" ] || { echo "Range request returned $RANGE, expected 206" >&2; exit 1; }

echo "OK: top hit starts at ${START}s; streaming supports Range."
