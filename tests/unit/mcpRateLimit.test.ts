import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('MCP_AUTH_FAILURES_PER_MINUTE', '2');
  vi.stubEnv('MCP_RATE_LIMIT_PER_MINUTE', '2');
});

import { mcpFailureLimit, mcpTokenLimit, requestLimit } from '../../src/shared/http/rateLimitMiddleware';

let server: Server;
let base = '';

beforeAll(() => {
  const app = express();
  app.get('/failures', mcpFailureLimit, (req, res) => {
    res.status(req.get('x-outcome') === 'reject' ? 401 : 200).json({ success: true });
  });
  app.get(
    '/tokens',
    (req, _res, next) => {
      req.mcpTokenId = req.get('x-token');
      next();
    },
    mcpTokenLimit,
    (_req, res) => {
      res.json({ success: true });
    }
  );
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  vi.unstubAllEnvs();
});

const get = (url: string, headers: Record<string, string> = {}) => fetch(`${base}${url}`, { headers });

describe('mcpFailureLimit', () => {
  it('counts only rejected tokens, then refuses with the standard error body', async () => {
    for (let i = 0; i < 4; i++) expect((await get('/failures')).status).toBe(200);
    expect((await get('/failures', { 'x-outcome': 'reject' })).status).toBe(401);
    expect((await get('/failures', { 'x-outcome': 'reject' })).status).toBe(401);
    const refused = await get('/failures');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ success: false, error: { code: 'RATE_LIMITED' } });
  });
});

describe('mcpTokenLimit', () => {
  it('gives every token its own budget', async () => {
    expect((await get('/tokens', { 'x-token': 'a' })).status).toBe(200);
    expect((await get('/tokens', { 'x-token': 'a' })).status).toBe(200);
    expect((await get('/tokens', { 'x-token': 'a' })).status).toBe(429);
    expect((await get('/tokens', { 'x-token': 'b' })).status).toBe(200);
  });
});

describe('requestLimit', () => {
  it('leaves /api/mcp/data to the MCP limiters', async () => {
    const app = express();
    app.use(requestLimit);
    app.get('/api/mcp/data/contexts', (_req, res) => {
      res.json({ success: true });
    });
    const local = app.listen(0);
    const url = `http://127.0.0.1:${(local.address() as AddressInfo).port}/api/mcp/data/contexts`;
    try {
      const reply = await fetch(url);
      expect(reply.status).toBe(200);
      expect(reply.headers.get('ratelimit-policy')).toBeNull();
    } finally {
      local.close();
    }
  });
});
