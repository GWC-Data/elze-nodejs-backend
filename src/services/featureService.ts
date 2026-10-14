import * as featureRepository from '../repositories/featureRepository';
import { fail } from '../tools/AppError';
import { audit, EVENTS } from './auditService';
import {
  FEATURES,
  FEATURE_BY_ID,
  TOGGLEABLE_FEATURE_KEYS,
  effectiveFeatures,
  featureIdsOf,
  featureKeysOf,
} from '../constants/features';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';

function catalogue() {
  return FEATURES.map(({ id, key, label, description, locked, covers }) => ({ id, key, label, description, locked, covers }));
}

function parseFeatureIds(featureIds: unknown): string[] {
  if (!Array.isArray(featureIds)) {
    throw fail('VALIDATION_ERROR', 'featureIds must be an array of feature ids.');
  }
  const unique = [...new Set(featureIds.map((v) => String(v).trim().toLowerCase()))];
  const unknown = unique.filter((id) => !FEATURE_BY_ID.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown feature id(s): ${unknown.join(', ')}`, { featureIds: unknown });
  }
  return featureKeysOf(unique).filter((key) => TOGGLEABLE_FEATURE_KEYS.includes(key));
}

async function enabledFor(companyId: number, conn?: Queryable): Promise<string[]> {
  return effectiveFeatures(featureKeysOf(await featureRepository.listForCompany(companyId, conn)));
}

function describe(enabled: readonly string[]) {
  return FEATURES.map(({ id, key, label, description, locked, covers }) => ({
    id,
    key,
    label,
    description,
    locked,
    covers,
    enabled: locked || enabled.includes(key),
  }));
}

async function companyFeatures(companyId: number) {
  return { companyId, features: describe(await enabledFor(companyId)) };
}

async function setInitialFeatures(actor: Actor, companyId: number, featureKeys: readonly string[], conn: Queryable) {
  await featureRepository.replace(companyId, featureIdsOf(featureKeys), actor.id, conn);
}

async function replaceCompanyFeatures(actor: Actor, companyId: number, featureIds: unknown) {
  const next = parseFeatureIds(featureIds);
  const before = await enabledFor(companyId);
  await featureRepository.replace(companyId, featureIdsOf(next), actor.id);
  const after = effectiveFeatures(next);

  const enabled = after.filter((key) => !before.includes(key));
  const disabled = before.filter((key) => !after.includes(key));
  if (enabled.length || disabled.length) {
    audit(EVENTS.COMPANY_FEATURES_UPDATED, actor, {
      companyId,
      enabled,
      disabled,
      enabledIds: featureIdsOf(enabled),
      disabledIds: featureIdsOf(disabled),
    });
  }
  return { companyId, features: describe(after) };
}

async function seedExistingCompanies(): Promise<void> {
  const n = await featureRepository.seedUnseeded(featureIdsOf(TOGGLEABLE_FEATURE_KEYS));
  if (n) console.log(`[rbac] enabled every feature for ${n} company(ies) with no feature settings yet`);
}

export {
  catalogue,
  parseFeatureIds,
  enabledFor,
  companyFeatures,
  setInitialFeatures,
  replaceCompanyFeatures,
  seedExistingCompanies,
};
