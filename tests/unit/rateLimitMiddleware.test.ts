import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubEnv('AUTH_RATE_LIMIT_PER_15_MIN', '2');
});

import { authLimit } from '../../src/shared/http/rateLimitMiddleware';

let server: Server;
let base = '';

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.post('/login', authLimit, (_req, res) => {
    res.json({ success: true });
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  vi.unstubAllEnvs();
});

function signIn(identifier: string) {
  return fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'x' }),
  });
}

describe('authLimit', () => {
  it('refuses an account past its limit with the standard error body', async () => {
    expect((await signIn('Alice')).status).toBe(200);
    expect((await signIn('alice ')).status).toBe(200);
    const refused = await signIn('ALICE');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBeTruthy();
    expect(await refused.json()).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait 15 minutes and try again.' },
    });
  });

  it('counts each account separately', async () => {
    expect((await signIn('bob')).status).toBe(200);
  });
});
