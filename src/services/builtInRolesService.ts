import * as companyRoleRepository from '../repositories/companyRoleRepository';
import * as roleRepository from '../repositories/roleRepository';
import { CUSTOM_ROLE_EXCLUDED, PLATFORM_ONLY_PERMISSIONS, USER } from '../constants/permissions';
import type { Queryable } from '../config/pgPool';

const COPIED_ROLES = [USER];

async function defaultsFor(roleName: string): Promise<string[]> {
  const ids = await roleRepository.permissionIds(roleName, { ordered: true });
  return ids.filter((id) => !PLATFORM_ONLY_PERMISSIONS.has(id) && !CUSTOM_ROLE_EXCLUDED.has(id));
}

async function seedForCompany(companyId: number, conn: Queryable): Promise<void> {
  for (const roleName of COPIED_ROLES) {
    await companyRoleRepository.seedBuiltInCopy(companyId, roleName, await defaultsFor(roleName), conn);
  }
}

async function backfillAndSync(): Promise<void> {
  for (const roleName of COPIED_ROLES) {
    const defaults = await defaultsFor(roleName);
    const created = await companyRoleRepository.backfillBuiltInCopies(roleName, defaults);
    if (created) console.log(`[rbac] created the ${roleName} role copy for ${created} company(ies)`);
    await companyRoleRepository.syncUnmodifiedBuiltInCopies(roleName, defaults);
  }
}

async function followDefaults(roleName: string): Promise<number> {
  if (!COPIED_ROLES.includes(roleName)) return 0;
  return companyRoleRepository.syncUnmodifiedBuiltInCopies(roleName, await defaultsFor(roleName));
}

export { COPIED_ROLES, defaultsFor, seedForCompany, backfillAndSync, followDefaults };
