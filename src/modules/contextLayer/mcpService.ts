import config from '../../config';
import { MCP_TOOLS as TOOLS } from './contextConstants';

const { mcpServer } = config.context;

const { url: SERVER_URL, authRequired: AUTH_REQUIRED } = mcpServer();

function serverKey(connectionName: string | null | undefined): string {
  const slug = String(connectionName || 'context')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `context-${slug || 'layer'}`;
}

interface McpServerConfig {
  type: string;
  url: string;
  headers?: { Authorization: string };
}

interface McpAccess {
  configured: boolean;
  serverName: string;
  serverUrl: string | null;
  transport: string;
  workspaceId: string;
  context: { name: string; version: string; publishedAt: Date | null };
  auth: { type: string; header?: string; format?: string; source?: string };
  tools: typeof TOOLS;
  clientConfig: { mcpServers: Record<string, McpServerConfig> } | null;
  usage: string;
}

function mcpDetails(
  connection: { id: string; name: string | null | undefined },
  published: { name: string; label: string; publishedAt: Date | null }
): McpAccess {
  const key = serverKey(connection.name);
  const headers = AUTH_REQUIRED ? { Authorization: 'Bearer <MCP access token>' } : undefined;

  return {
    configured: Boolean(SERVER_URL),
    serverName: key,
    serverUrl: SERVER_URL,
    transport: 'streamable-http',
    workspaceId: connection.id,
    context: { name: published.name, version: published.label, publishedAt: published.publishedAt },
    auth: AUTH_REQUIRED
      ? {
          type: 'bearer',
          header: 'Authorization',
          format: 'Bearer <token>',
          source: 'Issued by your platform administrator (the MCP reader access token).',
        }
      : { type: 'none' },
    tools: TOOLS,
    clientConfig: SERVER_URL
      ? {
          mcpServers: {
            [key]: {
              type: 'http',
              url: SERVER_URL,
              ...(headers ? { headers } : {}),
            },
          },
        }
      : null,
    usage: `Pass "context_id": "${connection.id}" on every tool call.`,
  };
}

export { mcpDetails };
export type { McpAccess };
