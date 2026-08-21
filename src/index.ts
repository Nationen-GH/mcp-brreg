#!/usr/bin/env node

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type Request, type Response } from 'express';
import cors from 'cors';

import { BrregMCPServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export interface Config {
  transport: 'stdio' | 'http';
  port: number;
  host: string;
  authToken?: string;
  allowedOrigins: string[];
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = (env.TRANSPORT ?? (env.PORT ? 'http' : 'stdio')).toLowerCase();
  // The HTTP+SSE transport is gone, but `sse` stays an accepted alias for
  // `http`: an existing TRANSPORT=sse deployment should keep serving /mcp
  // rather than silently degrade to a stdio process with no listener.
  const transport = raw === 'sse' || raw === 'http' ? 'http' : 'stdio';

  const port = Number.parseInt(env.PORT ?? '3000', 10);

  return {
    transport,
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    host: env.HOST ?? '0.0.0.0',
    authToken: env.AUTH_TOKEN || env.BEARER_TOKEN || undefined,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '*')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}

/**
 * Constant-time token comparison.
 *
 * Comparing secrets with `!==` leaks their prefix through response timing. The
 * length check short-circuits, which is fine — a token's length is not the
 * secret — but the byte comparison itself must not.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // Query-string tokens are accepted for clients that cannot set headers, but
  // they leak into access logs and proxy history — prefer the header.
  if (typeof req.query.token === 'string') return req.query.token;
  if (typeof req.query.auth === 'string') return req.query.auth;
  return undefined;
}

async function runStdio(): Promise<void> {
  const server = new BrregMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the JSON-RPC stream, so every log line goes to stderr.
  console.error(`${SERVER_NAME} ${SERVER_VERSION} running on stdio`);

  installShutdownHandlers(() => server.close());
}

async function runHttp(config: Config): Promise<void> {
  const app = express();

  app.use(
    cors({
      origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
      // Browser clients must be able to read the session id the Streamable HTTP
      // transport assigns, and to echo it back on subsequent requests.
      exposedHeaders: ['Mcp-Session-Id'],
      // Last-Event-ID belongs to Streamable HTTP's own resumable GET stream, not
      // to the removed HTTP+SSE transport. Dropping it breaks stream resumption.
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Last-Event-ID'],
    })
  );

  const requireAuth = (req: Request, res: Response): boolean => {
    if (!config.authToken) return true;

    const token = extractToken(req);
    if (!token || !tokensMatch(token, config.authToken)) {
      res.status(401).json({ error: 'Unauthorized: invalid or missing bearer token' });
      return false;
    }
    return true;
  };

  const httpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: BrregMCPServer }
  >();

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: SERVER_NAME,
      version: SERVER_VERSION,
      authRequired: Boolean(config.authToken),
      sessions: { streamableHttp: httpSessions.size },
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'Brønnøysundregistrene MCP Server',
      version: SERVER_VERSION,
      description: 'Model Context Protocol server for the Norwegian Business Registry',
      endpoints: {
        mcp: '/mcp (Streamable HTTP)',
        health: '/health',
      },
      authRequired: Boolean(config.authToken),
    });
  });

  // -- Streamable HTTP (MCP 2025-03-26 and later) ----------------------------

  app.all('/mcp', express.json({ limit: '4mb' }), async (req, res) => {
    if (!requireAuth(req, res)) return;

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? httpSessions.get(sessionId) : undefined;

    if (existing) {
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (typeof sessionId === 'string') {
      res.status(404).json({ error: `Unknown session: ${sessionId}` });
      return;
    }

    // No session yet, so this must be an initialize request: stand up a fresh
    // server/transport pair and let the transport mint the session id.
    const server = new BrregMCPServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        httpSessions.set(id, { transport, server });
        console.error(`MCP session opened: ${id}`);
      },
      onsessionclosed: (id) => {
        httpSessions.delete(id);
        console.error(`MCP session closed: ${id}`);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) httpSessions.delete(transport.sessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const httpServer: HttpServer = app.listen(config.port, config.host, () => {
    console.error(
      `${SERVER_NAME} ${SERVER_VERSION} listening on http://${config.host}:${config.port}`
    );
    console.error('  Streamable HTTP: /mcp');
    console.error(`  Auth required:   ${Boolean(config.authToken)}`);
    if (!config.authToken) {
      console.error(
        '  WARNING: AUTH_TOKEN is unset - anyone who can reach this port can use the server.'
      );
    }
  });

  installShutdownHandlers(async () => {
    await Promise.allSettled([...httpSessions.values()].map(({ server }) => server.close()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });
}

/**
 * Close transports on SIGTERM/SIGINT so `docker stop` shuts down promptly
 * instead of waiting out the grace period and being killed.
 */
function installShutdownHandlers(shutdown: () => Promise<void>): void {
  let shuttingDown = false;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.error(`Received ${signal}, shutting down`);

      // Never let a stuck connection hold the container open indefinitely.
      const timer = setTimeout(() => process.exit(1), 10_000);
      timer.unref?.();

      shutdown()
        .then(() => process.exit(0))
        .catch((error) => {
          console.error('Error during shutdown:', error);
          process.exit(1);
        });
    });
  }
}

export async function main(): Promise<void> {
  const config = readConfig();

  if ((process.env.TRANSPORT ?? '').toLowerCase() === 'sse') {
    console.error(
      'WARNING: TRANSPORT=sse is deprecated and starts the Streamable HTTP transport. ' +
        'The /sse and /messages endpoints have been removed - point clients at /mcp ' +
        'and set TRANSPORT=http.'
    );
  }

  if (config.transport === 'http') await runHttp(config);
  else await runStdio();
}

/** True when this module is the process entrypoint rather than an import. */
function isEntrypoint(): boolean {
  const argv = process.argv[1];
  if (!argv) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
