FROM node:20-alpine AS base
RUN npm install -g pnpm@9

# ── Dependencies ──
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile || pnpm install

# ── Build ──
FROM base AS build
WORKDIR /app

COPY --from=deps /app .
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

RUN pnpm --filter web build

# ── Production ──
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/apps/web/.next apps/web/.next
COPY --from=build /app/apps/web/public apps/web/public
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/apps/web/next.config.js apps/web/
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json .

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "start"]
