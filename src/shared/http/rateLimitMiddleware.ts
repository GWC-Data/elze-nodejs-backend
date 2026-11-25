import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import config from '../../config';

const { RATE_LIMIT_PER_MINUTE, AUTH_RATE_LIMIT_PER_15_MIN, MCP_RATE_LIMIT_PER_MINUTE, MCP_AUTH_FAILURES_PER_MINUTE } =
  config.http;

const MINUTE_MS = 60 * 1000;
const MCP_DATA_PATH = '/api/mcp/data';

function isMcpDataRequest(req: Request): boolean {
  return req.path === MCP_DATA_PATH || req.path.startsWith(`${MCP_DATA_PATH}/`);
}

function ipKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

function mcpTokenKey(req: Request): string {
  return req.mcpTokenId ? `token:${req.mcpTokenId}` : ipKey(req);
}

function refuse(message: string) {
  return (_req: Request, res: Response): void => {
    res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message } });
  };
}

function accountKey(req: Request): string {
  const identifier = (req.body as { identifier?: unknown } | undefined)?.identifier;
  if (typeof identifier === 'string' && identifier.trim()) return `account:${identifier.trim().toLowerCase()}`;
  return ipKey(req);
}

const requestLimit = rateLimit({
  windowMs: MINUTE_MS,
  limit: RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: isMcpDataRequest,
  handler: refuse('Too many requests. Wait a minute and try again.'),
});

const mcpFailureLimit = rateLimit({
  windowMs: MINUTE_MS,
  limit: MCP_AUTH_FAILURES_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: ipKey,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  handler: refuse('Too many rejected MCP tokens. Wait a minute and try again.'),
});

const mcpTokenLimit = rateLimit({
  windowMs: MINUTE_MS,
  limit: MCP_RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: mcpTokenKey,
  handler: refuse('Too many requests with this MCP token. Wait a minute and try again.'),
});

const authLimit = rateLimit({
  windowMs: 15 * MINUTE_MS,
  limit: AUTH_RATE_LIMIT_PER_15_MIN,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: accountKey,
  handler: refuse('Too many attempts. Wait 15 minutes and try again.'),
});

export { requestLimit, authLimit, mcpFailureLimit, mcpTokenLimit };
