#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:${APP_PORT:-4000}"
TOKEN="${TOKEN:-}"

curl -sf "$API/health/live" >/dev/null && echo "live OK"
curl -sf "$API/health/ready" | jq '.ok' | grep -q true && echo "ready OK"

if [ -n "$TOKEN" ]; then
  curl -sf -H "authorization: Bearer $TOKEN" "$API/leaderboard/weekly" >/dev/null && echo "leaderboard OK"
  curl -sf -H "authorization: Bearer $TOKEN" "$API/me/profile" >/dev/null && echo "profile GET OK"
fi
echo "e2e smoke done"