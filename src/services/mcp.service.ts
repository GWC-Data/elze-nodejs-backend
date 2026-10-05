import config from '../config';
import { MCP_TOOLS as TOOLS } from '../constants/context';

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

function mcpDetails(connection: Record<string, any>, published: Record<string, any>): Record<string, any> {
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
    usage: `Pass "workspace_id": "${connection.id}" on every tool call.`,
  };
}

export { mcpDetails };
