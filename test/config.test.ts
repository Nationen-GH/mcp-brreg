import { describe, expect, test } from 'bun:test';
import { readConfig, tokensMatch } from '../src/index.js';

describe('readConfig', () => {
  test('defaults to stdio with no environment', () => {
    expect(readConfig({}).transport).toBe('stdio');
  });

  test('switches to http when PORT is set', () => {
    const config = readConfig({ PORT: '8080' });
    expect(config.transport).toBe('http');
    expect(config.port).toBe(8080);
  });

  test('still treats the deprecated "sse" value as http', () => {
    expect(readConfig({ TRANSPORT: 'sse' }).transport).toBe('http');
    expect(readConfig({ TRANSPORT: 'SSE' }).transport).toBe('http');
  });

  test('an explicit TRANSPORT beats the PORT inference', () => {
    expect(readConfig({ TRANSPORT: 'stdio', PORT: '8080' }).transport).toBe('stdio');
  });

  test('falls back to 3000 on an unparseable port', () => {
    expect(readConfig({ PORT: 'not-a-port' }).port).toBe(3000);
    expect(readConfig({ PORT: '-1' }).port).toBe(3000);
  });

  test('accepts either token variable, preferring AUTH_TOKEN', () => {
    expect(readConfig({ AUTH_TOKEN: 'a', BEARER_TOKEN: 'b' }).authToken).toBe('a');
    expect(readConfig({ BEARER_TOKEN: 'b' }).authToken).toBe('b');
    expect(readConfig({ AUTH_TOKEN: '' }).authToken).toBeUndefined();
  });

  test('parses a comma-separated origin allowlist', () => {
    expect(readConfig({}).allowedOrigins).toEqual(['*']);
    expect(
      readConfig({ ALLOWED_ORIGINS: 'https://a.test, https://b.test' }).allowedOrigins
    ).toEqual(['https://a.test', 'https://b.test']);
  });
});

describe('tokensMatch', () => {
  test('accepts an identical token and rejects anything else', () => {
    expect(tokensMatch('s3cret', 's3cret')).toBe(true);
    expect(tokensMatch('s3cret', 's3crey')).toBe(false);
    // Differing lengths must not throw the way a bare timingSafeEqual would.
    expect(tokensMatch('short', 'much-longer-token')).toBe(false);
    expect(tokensMatch('', '')).toBe(true);
  });

  test('handles multi-byte tokens by comparing bytes, not code points', () => {
    expect(tokensMatch('nøkkel', 'nøkkel')).toBe(true);
    expect(tokensMatch('nøkkel', 'nokkel')).toBe(false);
  });
});
