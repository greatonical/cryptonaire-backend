#!/usr/bin/env bash
set -euo pipefail

# Load .env if present
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

APP_PORT="${APP_PORT:-4000}"
API_ORIGIN="http://localhost:${APP_PORT}"

pass() { printf "✅ %s\n" "$1"; }
fail() { printf "❌ %s\n" "$1"; exit 1; }
info() { printf "ℹ️  %s\n" "$1"; }

info "Starting Cryptonaire smoke checks..."

# 1) Health endpoint (if API is running)
if command -v curl >/dev/null 2>&1; then
  if curl -sS --max-time 2 "${API_ORIGIN}/health" >/dev/null 2>&1; then
    pass "API liveness: ${API_ORIGIN}/health"
  else
    info "API not responding on ${API_ORIGIN}/health (this is OK if server isn't running)."
  fi
else
  info "curl not found; skipping HTTP checks."
fi

# 2) Postgres connectivity (DATABASE_URL required)
if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is not set"
fi

node - <<'NODE'
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
(async () => {
  const client = new Client({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined });
  try {
    await client.connect();
    const r = await client.query('select 1 as ok');
    if (r && r.rows && r.rows[0] && r.rows[0].ok === 1) {
      console.log('PG OK');
      process.exit(0);
    } else {
      console.error('PG query failed');
      process.exit(2);
    }
  } catch (e) {
    console.error('PG error:', e.message);
    process.exit(2);
  } finally {
    try { await client.end(); } catch {}
  }
})();
NODE
[ $? -eq 0 ] && pass "Postgres connection OK" || fail "Postgres connection failed"

# 3) Redis connectivity (REDIS_URL required)
if [ -z "${REDIS_URL:-}" ]; then
  fail "REDIS_URL is not set"
fi

node - <<'NODE'
const Redis = require('ioredis');
(async () => {
  const url = process.env.REDIS_URL;
  const redis = new Redis(url, { tls: url.startsWith('rediss://') ? {} : undefined, lazyConnect: true });
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong && pong.toUpperCase() === 'PONG') {
      console.log('Redis OK');
      process.exit(0);
    } else {
      console.error('Redis ping failed:', pong);
      process.exit(3);
    }
  } catch (e) {
    console.error('Redis error:', e.message);
    process.exit(3);
  } finally {
    try { await redis.quit(); } catch {}
  }
})();
NODE
[ $? -eq 0 ] && pass "Redis connection OK" || fail "Redis connection failed"

# 4) JWT keys present
if [[ "${JWT_PRIVATE_KEY:-}" == *"BEGIN PRIVATE KEY"* ]] && [[ "${JWT_PUBLIC_KEY:-}" == *"BEGIN PUBLIC KEY"* ]]; then
  pass "JWT keys present"
else
  info "JWT keys missing or placeholders present. Ensure JWT_PRIVATE_KEY / JWT_PUBLIC_KEY are set with \\n escapes."
fi

pass "Smoke checks completed"