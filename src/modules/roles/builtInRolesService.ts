import * as companyRoleRepository from './companyRoleRepository';
import * as roleRepository from './roleRepository';
import { USER } from '../catalogue/roleTiers';
import {
  isAdminOnly,
  isPlatformOnly,
  permissionIdsOf,
  permissionKeysOf,
  systemRoleId,
} from '../catalogue/catalogueService';
import type { Tx } from '../../shared/db/database';

const COPIED_ROLES = [USER];

async function defaultsFor(roleName: string): Promise<string[]> {
  const ids = await roleRepository.permissionIds(systemRoleId(roleName));
  return permissionKeysOf(ids).filter((key) => !isPlatformOnly(key) && !isAdminOnly(key));
}

async function defaultIdsFor(roleName: string): Promise<string[]> {
  return permissionIdsOf(await defaultsFor(roleName));
}

async function seedForCompany(companyId: number, conn: Tx): Promise<void> {
  await companyRoleRepository.seedCompanyDefault(companyId, await defaultIdsFor(USER), conn);
}

async function followDefaults(roleName: string): Promise<number> {
  if (!COPIED_ROLES.includes(roleName)) return 0;
  return companyRoleRepository.syncUnmodifiedCompanyDefaults(await defaultIdsFor(roleName));
}

export { COPIED_ROLES, defaultsFor, seedForCompany, followDefaults };
