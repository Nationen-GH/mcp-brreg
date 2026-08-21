#!/usr/bin/env node
/**
 * Boot the compiled server under plain Node over stdio and exercise it through
 * a real MCP client: list the tools, then call the one tool that answers
 * without network access.
 *
 * Guards the two failure modes that unit tests cannot see — the package not
 * running outside Bun, and `data/nace-codes-full.json` not being found when the
 * process is started from another working directory.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entrypoint = join(repoRoot, 'dist', 'index.js');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entrypoint],
  // Deliberately not the repo root: the server must resolve its data file
  // relative to its own module, not to process.cwd().
  cwd: tmpdir(),
  env: { ...process.env, TRANSPORT: 'stdio', PATH: process.env.PATH ?? '' },
  stderr: 'inherit',
});

const client = new Client({ name: 'smoke-test', version: '1.0.0' }, { capabilities: {} });

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`connected, ${tools.length} tools advertised`);
  if (tools.length === 0) fail('server advertised no tools');

  for (const name of ['search_companies', 'get_company', 'search_nace_codes']) {
    if (!tools.some((tool) => tool.name === name)) fail(`missing expected tool: ${name}`);
  }

  // Offline lookup: proves the bundled classification loaded from a foreign cwd.
  const result = await client.callTool({
    name: 'search_nace_codes',
    arguments: { exactCode: '01.110' },
  });

  if (result.isError) fail(`search_nace_codes returned an error: ${result.content?.[0]?.text}`);

  const payload = JSON.parse(result.content[0].text);
  if (payload.totalResults !== 1 || payload.codes?.[0]?.code !== '01.110') {
    fail(`unexpected NACE payload: ${JSON.stringify(payload).slice(0, 200)}`);
  } else {
    console.log(`NACE lookup OK: ${payload.codes[0].code} ${payload.codes[0].name}`);
  }

  if (process.exitCode !== 1) console.log('stdio smoke test passed');
} catch (error) {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
} finally {
  await client.close().catch(() => {});
}
