import * as featureRepository from './featureRepository';
import { fail } from '../../shared/errors/AppError';
import { audit, EVENTS } from '../audit/auditService';
import {
  allFeatures,
  effectiveFeatures,
  featureById,
  featureIdsOf,
  featureKeysOf,
  toggleableFeatureKeys,
} from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';

function catalogue() {
  return allFeatures().map(({ id, key, label, description, locked, covers }) => ({
    id,
    key,
    label,
    description,
    locked,
    covers,
  }));
}

function parseFeatureIds(featureIds: unknown): string[] {
  if (!Array.isArray(featureIds)) {
    throw fail('VALIDATION_ERROR', 'featureIds must be an array of feature ids.');
  }
  const unique = [...new Set(featureIds.map((v) => String(v).trim().toLowerCase()))];
  const unknown = unique.filter((id) => !featureById(id));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown feature id(s): ${unknown.join(', ')}`, { featureIds: unknown });
  }
  const toggleable = toggleableFeatureKeys();
  return featureKeysOf(unique).filter((key) => toggleable.includes(key));
}

async function enabledFor(companyId: number, conn?: Tx): Promise<string[]> {
  return effectiveFeatures(featureKeysOf(await featureRepository.listForCompany(companyId, conn)));
}

function describe(enabled: readonly string[]) {
  return allFeatures().map(({ id, key, label, description, locked, covers }) => ({
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

async function setInitialFeatures(actor: Actor, companyId: number, featureKeys: readonly string[], conn: Tx) {
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

export { catalogue, parseFeatureIds, enabledFor, companyFeatures, setInitialFeatures, replaceCompanyFeatures };
