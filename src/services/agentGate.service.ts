// The permission check for the agent service the browser calls directly: the Elze-backend ADK
// API, which serves every agent (data analyst, playbooks, Metadata Lakehouse extraction). It
// takes no part in this app's sign-in, so nginx asks this service first: every /svc/adk/*
// request makes an `auth_request` subrequest to GET /api/gate/agents carrying the original
// path and method, and is only proxied on a 2xx (frontend/nginx.conf).
//
// What this gives: only a signed-in account whose company has the feature and whose role has
// the permission reaches an agent at all, and the workspace must be a connection of the
// caller's own company. What it does not: the ADK API still does not know WHO is calling
// inside that workspace (it sees a shared X-API-Key).
//
// Anything not recognised is refused - a new agent route must be added to the table below.

import { fail } from '../tools/AppError';
import { can, assertPermission } from './authorization.service';
import { requireConnectionId } from './connection.service';
import type { Actor } from '../types/actor';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface Rule {
  // Path under the service, without the /svc/<name> prefix.
  match: RegExp;
  // Any ONE of these is enough.
  anyOf: (method: string) => string[];
}

// ADK API (adk_agents/api/main.py): everything but /health is under one workspace, and a
// workspace_id is a connection id. Paths below are relative to /workspaces/{workspace_id}.
const ADK_WORKSPACE_RE = /^\/workspaces\/([^/]+)(\/.*)?$/;

const ADK_RULES: Rule[] = [
  // The Metadata Lakehouse extraction agent, and the Understand step's chat with it. The agent
  // can write facts, so talking to it is editing the context.
  { match: /^\/agents\/context_layer_extractor(\/|$)/, anyOf: (m) => (READS.has(m) ? ['context.read'] : ['context.update']) },
  // The data analyst chat; Playbooks → Analyse opens one seeded with a playbook.
  { match: /^\/agents\/data_analyst(\/|$)/, anyOf: () => ['analyst.use', 'playbook.run'] },
  // Building a playbook, and editing or publishing a draft, all happen in the builder.
  { match: /^\/(agents\/playbook_builder|playbook-builder)(\/|$)/, anyOf: () => ['playbook.create', 'playbook.update'] },
  { match: /^\/playbooks(\/|$)/, anyOf: (m) => (READS.has(m) ? ['playbook.read'] : ['playbook.update']) },
  { match: /^\/context-objects(\/|$)/, anyOf: (m) => (READS.has(m) ? ['context.read'] : ['context.update']) },
];

function splitUri(uri: string): { service: string; path: string } | null {
  const bare = uri.split('?')[0];
  const m = /^\/svc\/(adk)(\/.*)?$/.exec(bare);
  if (!m) return null;
  let path = m[2] || '/';
  try { path = decodeURIComponent(path); } catch { return null; }
  if (path.includes('/../') || path.endsWith('/..')) return null;
  return { service: m[1], path };
}

function requireAny(actor: Actor, permissions: string[]): void {
  if (permissions.some((p) => can(actor, p))) return;
  // Throws the specific refusal: FEATURE_NOT_ENABLED or INSUFFICIENT_PERMISSION.
  assertPermission(actor, permissions[0]);
}

async function checkAgentRequest(actor: Actor, uri: unknown, method: unknown): Promise<void> {
  const target = typeof uri === 'string' ? splitUri(uri) : null;
  const verb = String(method || 'GET').toUpperCase();
  if (!target) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');

  if (target.path === '/health') return;
  const m = ADK_WORKSPACE_RE.exec(target.path);
  if (!m) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');
  const [, workspaceId, rest = '/'] = m;

  const rule = ADK_RULES.find((r) => r.match.test(rest));
  if (!rule) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');
  requireAny(actor, rule.anyOf(verb));
  // workspace_id is a connection id: it must be one of the caller's company's connections.
  await requireConnectionId(actor, workspaceId);
}

export { checkAgentRequest };
