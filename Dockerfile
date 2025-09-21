# syntax=docker/dockerfile:1

###########
# Base
###########
FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# prisma needs openssl on alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

###########
# Builder
###########
FROM base AS builder

# Only lockfile + package.json first for better caching
COPY package.json pnpm-lock.yaml ./
# Prisma schema for generate step
COPY prisma ./prisma

# Install deps (cached)
RUN --mount=type=cache,id=pnpm-store,target=/pnpmstore \
    pnpm install --frozen-lockfile

# Generate Prisma client at build time
RUN pnpm prisma:generate

# Bring in source and build
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build

###########
# Runner
###########
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy only what we need to run
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./

EXPOSE 4000

# Entry script runs migrations then starts the app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

CMD ["/entrypoint.sh"]