import * as bootstrapRepository from '../repositories/bootstrapRepository';
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PLATFORM_ONLY_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
  SYSTEM_ROLES,
} from '../constants/permissions';
import { FEATURES, FEATURE_BY_KEY, FEATURE_OF_PERMISSION } from '../constants/features';
import { ACCESS_LEVEL_CATALOGUE } from '../constants/accessLevels';
import type { Queryable } from '../config/pgPool';

const PERMISSION_ROWS = ALL_PERMISSIONS.map((p) => {
  const feature = FEATURE_OF_PERMISSION.get(p.key);
  return {
    id: p.id,
    key: p.key,
    label: p.label,
    description: p.description,
    featureId: feature ? FEATURE_BY_KEY.get(feature)!.id : null,
    platformOnly: PLATFORM_ONLY_PERMISSIONS.has(p.key),
    adminOnly: CUSTOM_ROLE_EXCLUDED.has(p.key),
  };
});

function assertCatalogue(): void {
  for (const feature of FEATURES) {
    const unknown = feature.permissions.filter((key) => !ALL_PERMISSION_KEYS.has(key));
    if (unknown.length) throw new Error(`Feature "${feature.key}" lists unknown permission(s): ${unknown.join(', ')}`);
  }
}

async function seedCatalogue(conn?: Queryable): Promise<Set<string>> {
  assertCatalogue();
  await bootstrapRepository.upsertFeatures(FEATURES, conn);
  await bootstrapRepository.upsertPermissions(PERMISSION_ROWS, conn);
  await bootstrapRepository.upsertAccessLevels(ACCESS_LEVEL_CATALOGUE, conn);
  const created = new Set<string>();
  for (const role of SYSTEM_ROLES) {
    const inserted = await bootstrapRepository.upsertSystemRole(
      { id: role.id, tier: role.name, name: role.label, description: role.description },
      conn
    );
    if (inserted) created.add(role.name);
  }
  return created;
}

export { seedCatalogue };
