import * as companyRoleRepository from '../repositories/companyRoleRepository';
import * as roleRepository from '../repositories/roleRepository';
import {
  CUSTOM_ROLE_EXCLUDED,
  PLATFORM_ONLY_PERMISSIONS,
  SYSTEM_ROLE_ID,
  USER,
  permissionIdsOf,
  permissionKeysOf,
} from '../constants/permissions';
import type { Queryable } from '../config/pgPool';

const COPIED_ROLES = [USER];

async function defaultsFor(roleName: string): Promise<string[]> {
  const ids = await roleRepository.permissionIds(SYSTEM_ROLE_ID[roleName]);
  return permissionKeysOf(ids).filter((key) => !PLATFORM_ONLY_PERMISSIONS.has(key) && !CUSTOM_ROLE_EXCLUDED.has(key));
}

async function defaultIdsFor(roleName: string): Promise<string[]> {
  return permissionIdsOf(await defaultsFor(roleName));
}

async function seedForCompany(companyId: number, conn: Queryable): Promise<void> {
  await companyRoleRepository.seedCompanyDefault(companyId, await defaultIdsFor(USER), conn);
}

async function backfillAndSync(): Promise<void> {
  const defaults = await defaultIdsFor(USER);
  const created = await companyRoleRepository.backfillCompanyDefaults(defaults);
  if (created) console.log(`[rbac] created the Member role for ${created} company(ies)`);
  await companyRoleRepository.syncUnmodifiedCompanyDefaults(defaults);
}

async function followDefaults(roleName: string): Promise<number> {
  if (!COPIED_ROLES.includes(roleName)) return 0;
  return companyRoleRepository.syncUnmodifiedCompanyDefaults(await defaultIdsFor(roleName));
}

export { COPIED_ROLES, defaultsFor, seedForCompany, backfillAndSync, followDefaults };
