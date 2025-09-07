#!/usr/bin/env bash
set -euo pipefail

if [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

pnpm exec prisma db seed