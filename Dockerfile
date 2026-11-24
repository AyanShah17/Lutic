FROM oven/bun:1.4.2-debian AS manifests
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY packages/agent/package.json packages/agent/
COPY packages/connectors/package.json packages/connectors/
COPY packages/core/package.json packages/core/

FROM manifests AS build
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM manifests AS production-deps
RUN bun install --production --frozen-lockfile --filter @lutic/web

FROM oven/bun:1.4.2-debian AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=production-deps /app/ ./
COPY --from=build --chown=bun:bun /app/apps/web/.next apps/web/.next
COPY apps/web/next.config.mjs apps/web/
COPY packages/core/src packages/core/src
COPY packages/connectors/src packages/connectors/src
COPY packages/agent/src packages/agent/src
COPY deploy/start-production.ts deploy/
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=25s --retries=5 \
  CMD bun -e 'const port = process.env.PORT ?? "3000"; const res = await fetch(`http://127.0.0.1:${port}/api/health`); if (!res.ok) process.exit(1);'
CMD ["sh", "-c", "bun deploy/start-production.ts && cd apps/web && exec bun node_modules/next/dist/bin/next start"]
