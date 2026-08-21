# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies, installed in their own stage so the layer caches on the
# lockfile alone and dev dependencies never reach the runtime image.
# ---------------------------------------------------------------------------
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM base AS release

LABEL org.opencontainers.image.title="Brønnøysundregistrene MCP Server" \
      org.opencontainers.image.description="MCP server for Brønnøysundregistrene (Norwegian Business Registry)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/bergea1/mcp-server-brreg"

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

# The oven/bun image ships a non-root `bun` user; nothing here needs root.
USER bun

# In stdio mode there is no HTTP listener to probe, so the script reports
# healthy rather than marking every stdio container unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/healthcheck"]

CMD ["bun", "run", "src/index.ts"]
