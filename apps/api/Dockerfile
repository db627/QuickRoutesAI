FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── Build stage ──
FROM base AS build
WORKDIR /app

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./

# Copy package sources
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

# Install dependencies
RUN pnpm install --frozen-lockfile || pnpm install

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# ── Production stage ──
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app .

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["pnpm", "--filter", "api", "start"]
