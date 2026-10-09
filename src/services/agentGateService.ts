import { fail } from '../tools/AppError';
import { can, assertPermission } from './authorizationService';
import { requireConnectionId } from './connectionService';
import type { ContextAccessLevel } from '../constants/context';
import type { Actor } from '../types/actor';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface Rule {
  match: RegExp;
  anyOf: (method: string) => string[];
  level?: (method: string) => ContextAccessLevel;
}

const VIEW_OR_EDIT = (m: string): ContextAccessLevel => (READS.has(m) ? 'view' : 'edit');

const ADK_CONTEXT_RE = /^\/contexts\/([^/]+)(\/.*)?$/;

const ADK_OPEN_PATHS = new Set(['/health', '/models']);

const ADK_RULES: Rule[] = [
  { match: /^\/(context-layer|description-editor)(\/|$)/, anyOf: () => ['context.read'], level: VIEW_OR_EDIT },
  { match: /^\/data-analyst(\/|$)/, anyOf: () => ['analyst.use', 'playbook.run'] },
  { match: /^\/playbook-builder(\/|$)/, anyOf: () => ['playbook.create', 'playbook.update'] },
  { match: /^\/playbooks(\/|$)/, anyOf: (m) => (READS.has(m) ? ['playbook.read'] : ['playbook.update']) },
  { match: /^\/context-(objects|versions)(\/|$)/, anyOf: () => ['context.read'], level: VIEW_OR_EDIT },
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
  assertPermission(actor, permissions[0]);
}

async function checkAgentRequest(actor: Actor, uri: unknown, method: unknown): Promise<void> {
  const target = typeof uri === 'string' ? splitUri(uri) : null;
  const verb = String(method || 'GET').toUpperCase();
  if (!target) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');

  if (ADK_OPEN_PATHS.has(target.path)) return;
  const m = ADK_CONTEXT_RE.exec(target.path);
  if (!m) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');
  const [, contextId, rest = '/'] = m;

  const rule = ADK_RULES.find((r) => r.match.test(rest));
  if (!rule) throw fail('INSUFFICIENT_PERMISSION', 'Unknown agent route.');
  requireAny(actor, rule.anyOf(verb));
  await requireConnectionId(actor, contextId, rule.level ? rule.level(verb) : 'view');
}

export { checkAgentRequest };
