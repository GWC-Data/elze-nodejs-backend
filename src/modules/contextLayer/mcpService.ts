import config from '../../config';
import { MCP_TOOLS as TOOLS } from './contextConstants';

const { mcpServer } = config.context;

const { url: SERVER_URL } = mcpServer();

const MCP_REMOTE_PACKAGE = 'mcp-remote@0.15.2';
const AUTH_ENV = 'ELZE_MCP_AUTH';
const TOKEN_PLACEHOLDER = '<token>';

interface DesktopServer {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface HttpServer {
  type: 'http';
  url: string;
  headers: { Authorization: string };
}

interface ClientTemplates {
  url: string;
  claudeDesktop: { mcpServers: Record<string, DesktopServer> };
  http: { mcpServers: Record<string, HttpServer> };
  claudeCode: string;
}

interface McpAccess {
  configured: boolean;
  serverName: string;
  transport: string;
  context: { connectionId: string; name: string; version: string; publishedAt: Date | null };
  urls: { context: string | null; all: string | null };
  auth: { type: 'bearer'; header: 'Authorization'; format: string; tokenPlaceholder: string; tokens: string };
  tools: typeof TOOLS;
  clients: { context: ClientTemplates | null; all: ClientTemplates | null };
  usage: string;
}

function serverKey(contextName: string | null | undefined): string {
  const slug = String(contextName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `elze-${slug || 'context'}`;
}

function contextUrl(connectionId: string, name: string): string | null {
  return SERVER_URL ? `${SERVER_URL}/${connectionId}/${encodeURIComponent(name)}` : null;
}

function templates(key: string, url: string | null): ClientTemplates | null {
  if (!url) return null;
  return {
    url,
    claudeDesktop: {
      mcpServers: {
        [key]: {
          command: 'npx',
          args: ['-y', MCP_REMOTE_PACKAGE, url, '--header', `Authorization:\${${AUTH_ENV}}`],
          env: { [AUTH_ENV]: `Bearer ${TOKEN_PLACEHOLDER}` },
        },
      },
    },
    http: {
      mcpServers: {
        [key]: { type: 'http', url, headers: { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } },
      },
    },
    claudeCode: `claude mcp add --transport http ${key} ${url} --header "Authorization: Bearer ${TOKEN_PLACEHOLDER}"`,
  };
}

function mcpDetails(
  connection: { id: string },
  published: { name: string; label: string; publishedAt: Date | null }
): McpAccess {
  const key = serverKey(published.name);
  const urls = { context: contextUrl(connection.id, published.name), all: SERVER_URL };

  return {
    configured: Boolean(SERVER_URL),
    serverName: key,
    transport: 'streamable-http',
    context: {
      connectionId: connection.id,
      name: published.name,
      version: published.label,
      publishedAt: published.publishedAt,
    },
    urls,
    auth: {
      type: 'bearer',
      header: 'Authorization',
      format: 'Bearer <personal MCP token>',
      tokenPlaceholder: TOKEN_PLACEHOLDER,
      tokens: '/api/mcp/tokens',
    },
    tools: TOOLS,
    clients: { context: templates(key, urls.context), all: templates('elze-contexts', urls.all) },
    usage:
      'Create a personal MCP token in Elze and send it as "Authorization: Bearer <token>". ' +
      'The context URL serves only this context; the all-contexts URL serves every published context you can read.',
  };
}

export { mcpDetails, serverKey, MCP_REMOTE_PACKAGE };
export type { McpAccess, ClientTemplates };
