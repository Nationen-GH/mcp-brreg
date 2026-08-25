# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release

LABEL org.opencontainers.image.title="Brønnøysundregistrene MCP Server" \
      org.opencontainers.image.description="MCP server for Brønnøysundregistrene (Norwegian Business Registry)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/Nationen-GH/mcp-brreg"

COPY --from=install /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY data ./data
COPY docker/healthcheck.sh /usr/local/bin/healthcheck

RUN chmod +x /usr/local/bin/healthcheck

ENV PORT=3000 \
    HOST=0.0.0.0 \
    TRANSPORT=http \
    NODE_ENV=production

EXPOSE 3000

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/healthcheck"]

CMD ["bun", "run", "src/index.ts"]
