import * as scopeRepository from '../repositories/scopeRepository';
import { fail } from '../tools/AppError';
import { scopeProblem } from '../validators/scopeValidator';
import { audit, EVENTS } from './auditService';
import type { Actor } from '../types/actor';

type ScopeDimension = Record<string, any>;
type UserScopes = Record<string, string[]>;

const DIMENSION_RE = /^[a-z0-9_]{1,64}$/;

const ENFORCED = false;

function loadDimensions(): ScopeDimension[] {
  let parsed;
  try {
    parsed = scopeRepository.readDimensionsFile();
  } catch (err: any) {
    console.warn(`[rbac] ignoring ${scopeRepository.configFileName()}: ${err.message}`);
    return [];
  }
  if (parsed === null) return [];

  const list: ScopeDimension[] = Array.isArray(parsed && parsed.dimensions) ? parsed.dimensions : [];
  return list.filter((d) => {
    if (!d || !DIMENSION_RE.test(String(d.dimension || ''))) {
      console.warn(`[rbac] skipping scope dimension with an invalid key: ${JSON.stringify(d)}`);
      return false;
    }
    if (!d.table || !d.column) {
      console.warn(`[rbac] scope dimension "${d.dimension}" needs both "table" and "column"`);
      return false;
    }
    return true;
  });
}

function findDimension(key: string): ScopeDimension | null {
  return loadDimensions().find((d) => d.dimension === key) || null;
}

async function scopeOptions() {
  const out: Array<{ dimension: string; label: string; values: unknown[]; error?: string }> = [];
  for (const dimension of loadDimensions()) {
    const label = dimension.label || dimension.dimension;
    try {
      out.push({ dimension: dimension.dimension, label, values: await scopeRepository.distinctValues(dimension) });
    } catch (err: any) {
      console.warn(`[rbac] scope dimension "${dimension.dimension}" is unreadable: ${err.message}`);
      out.push({ dimension: dimension.dimension, label, values: [], error: err.message });
    }
  }
  return { enforced: ENFORCED, dimensions: out };
}

async function getUserScopes(userId: number): Promise<UserScopes> {
  if (!userId) return {};
  const scopes: UserScopes = {};
  for (const row of await scopeRepository.userScopeRows(userId)) {
    (scopes[row.dimension] = scopes[row.dimension] || []).push(row.value);
  }
  return scopes;
}

async function describeUserScopes(user: { id: number }) {
  return { userId: user.id, scopes: await getUserScopes(user.id), enforced: ENFORCED };
}

async function replaceUserScopes(
  actor: Actor,
  user: { id: number; username: string },
  scopes: Record<string, unknown[]>
) {
  const problem = scopeProblem(scopes, findDimension);
  if (problem) throw fail('VALIDATION_ERROR', problem);

  const unique = Object.fromEntries(
    Object.entries(scopes).map(([dimension, values]) => [dimension, [...new Set(values.map((v) => String(v)))]])
  );
  await scopeRepository.replaceUserScopes(user.id, unique);

  audit(EVENTS.USER_SCOPE_UPDATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    dimensions: Object.keys(scopes),
  });
  return { userId: user.id, scopes, enforced: ENFORCED };
}

export { scopeOptions, describeUserScopes, replaceUserScopes };
