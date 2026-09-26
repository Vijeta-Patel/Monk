# Monk services (chaos proxy, API + dashboard, channels, cron) in one container.
FROM node:24-bookworm-slim
RUN corepack enable 2>/dev/null || npm i -g pnpm@12 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY chaos ./chaos
RUN pnpm install --frozen-lockfile --filter '!@monk/tui' && pnpm --filter @monk/dashboard build
ENV GITHUB_MCP=remote
EXPOSE 8787 8788
CMD ["node", "packages/cli/src/bin.ts", "up"]
