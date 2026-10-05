import * as featureRepository from '../repositories/feature.repository';
import { fail } from '../tools/AppError';
import { audit, EVENTS } from './audit.service';
import { FEATURES, FEATURE_BY_ID, TOGGLEABLE_FEATURE_IDS, effectiveFeatures } from '../constants/features';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';

function catalogue() {
  return FEATURES.map(({ id, label, description, locked, covers }) => ({ id, label, description, locked, covers }));
}

// Validates a toggle list from a request body. Locked features may be sent (the UI shows them
// switched on) and are ignored - they are not stored. Anything else unknown is an error.
function parseFeatureList(features: unknown): string[] {
  if (!Array.isArray(features)) {
    throw fail('VALIDATION_ERROR', 'features must be an array of feature ids.');
  }
  const unique = [...new Set(features.map(String))];
  const unknown = unique.filter((id) => !FEATURE_BY_ID.has(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown feature id(s): ${unknown.join(', ')}`, { features: unknown });
  }
  return unique.filter((id) => TOGGLEABLE_FEATURE_IDS.includes(id));
}

async function enabledFor(companyId: number, conn?: Queryable): Promise<string[]> {
  return effectiveFeatures(await featureRepository.listForCompany(companyId, conn));
}

function describe(enabled: readonly string[]) {
  return FEATURES.map(({ id, label, description, locked, covers }) => ({
    id,
    label,
    description,
    locked,
    covers,
    enabled: locked || enabled.includes(id),
  }));
}

async function companyFeatures(companyId: number) {
  return { companyId, features: describe(await enabledFor(companyId)) };
}

// Used inside createCompany's transaction, so a company never exists without its choice.
async function setInitialFeatures(actor: Actor, companyId: number, featureIds: readonly string[], conn: Queryable) {
  await featureRepository.replace(companyId, featureIds, actor.id, conn);
}

async function replaceCompanyFeatures(actor: Actor, companyId: number, features: unknown) {
  const next = parseFeatureList(features);
  const before = await enabledFor(companyId);
  await featureRepository.replace(companyId, next, actor.id);
  const after = effectiveFeatures(next);

  const enabled = after.filter((id) => !before.includes(id));
  const disabled = before.filter((id) => !after.includes(id));
  if (enabled.length || disabled.length) {
    audit(EVENTS.COMPANY_FEATURES_UPDATED, actor, { companyId, enabled, disabled });
  }
  return { companyId, features: describe(after) };
}

async function seedExistingCompanies(): Promise<void> {
  const n = await featureRepository.seedUnseeded(TOGGLEABLE_FEATURE_IDS);
  if (n) console.log(`[rbac] enabled every feature for ${n} company(ies) created before feature toggles`);
}

export {
  catalogue,
  parseFeatureList,
  enabledFor,
  companyFeatures,
  setInitialFeatures,
  replaceCompanyFeatures,
  seedExistingCompanies,
};
