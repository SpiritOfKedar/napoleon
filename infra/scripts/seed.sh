#!/bin/sh
# Uploads infra/sample/sample-meeting.wav once so search works on first launch.
# Idempotent: does nothing if a file with that name is already in the library.
set -eu

if [ "${SEED_SAMPLE:-true}" != "true" ]; then
  echo "SEED_SAMPLE is not true; skipping."
  exit 0
fi

API="${API_URL:-http://localhost:8080/api}"
SAMPLE="${SAMPLE_FILE:-$(dirname "$0")/../sample/sample-meeting.wav}"
NAME="$(basename "$SAMPLE")"

echo "Waiting for $API ..."
i=0
until curl -fsS "$API/media" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then echo "Backend not reachable at $API" >&2; exit 1; fi
  sleep 2
done

if curl -fsS "$API/media" | grep -q "\"filename\":\"$NAME\""; then
  echo "$NAME is already uploaded; nothing to do."
  exit 0
fi

echo "Uploading $NAME ..."
curl -fsS -F "file=@$SAMPLE" "$API/media"
echo
echo "Uploaded. It will show as INDEXED in the Library once transcription finishes."
