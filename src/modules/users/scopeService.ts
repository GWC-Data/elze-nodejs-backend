import * as scopeRepository from './scopeRepository';
import { fail, messageOf } from '../../shared/errors/AppError';
import { scopeProblem } from './scopeValidator';
import { audit, EVENTS } from '../audit/auditService';
import type { Actor } from '../../shared/types/actor';
import type { ScopeDimension } from './scopeRepository';

type UserScopes = Record<string, string[]>;

const ENFORCED = false;

async function scopeOptions() {
  const out: Array<{ dimension: string; label: string; values: unknown[]; error?: string }> = [];
  for (const dimension of await scopeRepository.listDimensions()) {
    const label = dimension.label || dimension.dimension;
    try {
      out.push({ dimension: dimension.dimension, label, values: await scopeRepository.distinctValues(dimension) });
    } catch (err) {
      console.warn(`[rbac] scope dimension "${dimension.dimension}" is unreadable: ${messageOf(err)}`);
      out.push({ dimension: dimension.dimension, label, values: [], error: messageOf(err) });
    }
  }
  return { enforced: ENFORCED, dimensions: out };
}

async function getUserScopes(userId: number): Promise<UserScopes> {
  if (!userId) return {};
  const scopes: UserScopes = {};
  for (const row of await scopeRepository.userScopeRows(userId)) {
    scopes[row.dimension] ??= [];
    scopes[row.dimension].push(row.value);
  }
  return scopes;
}

async function describeUserScopes(user: { id: number }) {
  return { userId: user.id, scopes: await getUserScopes(user.id), enforced: ENFORCED };
}

async function replaceUserScopes(actor: Actor, user: { id: number; username: string }, requested: unknown) {
  const dimensions = new Map<string, ScopeDimension>(
    (await scopeRepository.listDimensions()).map((d) => [d.dimension, d])
  );
  const problem = scopeProblem(requested, (key) => dimensions.get(key) || null);
  if (problem) throw fail('VALIDATION_ERROR', problem);
  const scopes = requested as Record<string, unknown[]>;

  const unique = Object.fromEntries(
    Object.entries(scopes).map(([dimension, values]) => [dimension, [...new Set(values.map((v) => String(v)))]])
  );
  await scopeRepository.replaceUserScopes(user.id, unique, actor.id);

  audit(EVENTS.USER_SCOPE_UPDATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    dimensions: Object.keys(scopes),
  });
  return describeUserScopes(user);
}

export { scopeOptions, describeUserScopes, replaceUserScopes };
