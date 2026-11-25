import type { McpTokenRow } from './mcpTokenRepository';

type McpTokenStatus = 'active' | 'expired' | 'revoked';

interface McpTokenView {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  status: McpTokenStatus;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

interface IssuedMcpToken extends McpTokenView {
  token: string;
}

function statusOf(row: Pick<McpTokenRow, 'revokedAt' | 'expiresAt'>, now: Date): McpTokenStatus {
  if (row.revokedAt) return 'revoked';
  return row.expiresAt.getTime() > now.getTime() ? 'active' : 'expired';
}

function shapeToken(row: McpTokenRow, now: Date = new Date()): McpTokenView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.tokenPrefix,
    scope: row.scope,
    status: statusOf(row, now),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}

function shapeIssued(row: McpTokenRow, token: string, now: Date = new Date()): IssuedMcpToken {
  return { ...shapeToken(row, now), token };
}

export { statusOf, shapeToken, shapeIssued };
export type { McpTokenStatus, McpTokenView, IssuedMcpToken };
