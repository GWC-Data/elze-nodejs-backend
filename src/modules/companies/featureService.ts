import * as featureRepository from './featureRepository';
import { fail } from '../../shared/errors/AppError';
import { audit, EVENTS } from '../audit/auditService';
import {
  effectiveFeatures,
  featureById,
  featureIdsOf,
  featureKeysOf,
  isHiddenFeature,
  toggleableFeatureKeys,
  visibleFeatureKeys,
  visibleFeatures,
} from '../catalogue/catalogueService';
import type { Actor } from '../../shared/types/actor';
import type { Tx } from '../../shared/db/database';

function catalogue() {
  return visibleFeatures().map(({ id, key, label, description, locked, covers }) => ({
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
  return featureKeysOf(unique).filter((key) => toggleable.includes(key) && !isHiddenFeature(key));
}

async function enabledFor(companyId: string, conn?: Tx): Promise<string[]> {
  return effectiveFeatures(featureKeysOf(await featureRepository.listForCompany(companyId, conn)));
}

async function visibleFor(companyId: string, conn?: Tx): Promise<string[]> {
  return visibleFeatureKeys(await enabledFor(companyId, conn));
}

function describe(enabled: readonly string[]) {
  return visibleFeatures().map(({ id, key, label, description, locked, covers }) => ({
    id,
    key,
    label,
    description,
    locked,
    covers,
    enabled: locked || enabled.includes(key),
  }));
}

async function companyFeatures(companyId: string) {
  return { companyId, features: describe(await enabledFor(companyId)) };
}

async function setInitialFeatures(actor: Actor, companyId: string, featureKeys: readonly string[], conn: Tx) {
  await featureRepository.replace(companyId, featureIdsOf(featureKeys), actor.id, conn);
}

async function replaceCompanyFeatures(actor: Actor, companyId: string, featureIds: unknown) {
  const before = await enabledFor(companyId);
  const next = [...parseFeatureIds(featureIds), ...before.filter((key) => isHiddenFeature(key))];
  await featureRepository.replace(companyId, featureIdsOf(next), actor.id);
  const after = effectiveFeatures(next);

  const enabled = visibleFeatureKeys(after.filter((key) => !before.includes(key)));
  const disabled = visibleFeatureKeys(before.filter((key) => !after.includes(key)));
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

export {
  catalogue,
  parseFeatureIds,
  enabledFor,
  visibleFor,
  companyFeatures,
  setInitialFeatures,
  replaceCompanyFeatures,
};
