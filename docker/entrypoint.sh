#!/bin/sh
set -e

echo "Running Prisma migrations (deploy)…"
pnpm exec prisma migrate deploy

# Optional: allow forcing generate at runtime if platform/env changed
if [ "$PRISMA_GENERATE_AT_RUNTIME" = "true" ]; then
  echo "Running prisma generate…"
  pnpm exec prisma generate
fi

echo "Starting Nest app…"
node dist/main.js