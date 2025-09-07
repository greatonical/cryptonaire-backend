#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}" # dev | deploy

if [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

case "$MODE" in
  dev)
    pnpm exec prisma migrate dev
    ;;
  deploy)
    pnpm exec prisma migrate deploy
    ;;
  *)
    echo "Usage: scripts/migrate.sh [dev|deploy]"
    exit 2
    ;;
esac