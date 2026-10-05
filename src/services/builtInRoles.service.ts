// Every company's own copy of the built-in Member (USER) role, stored in company_roles
// (builtin_role = 'USER') + company_role_permissions.
//
//   - Created with the company, in the same transaction (company.service createCompany), and
//     backfilled once for companies that predate it (bootstrap).
//   - Until the company admin edits it (modified_at NULL) it FOLLOWS the platform owner's
//     defaults: the shared `role_permissions` rows for USER, re-copied at every start and
//     whenever the platform owner saves USER on Platform -> Roles.
//   - Once edited it is that company's own: only that company sees it, and nothing but the
//     company admin (or Reset, which makes it follow the defaults again) changes it.
//
// COMPANY_ADMIN stays a single shared role: a company may not edit it, so an admin can never
// trim their own role into a lock-out.
//
// Kept apart from companyRole.service so company.service, role.service and bootstrap can use it
// without importing each other.

import * as companyRoleRepository from '../repositories/companyRole.repository';
import * as roleRepository from '../repositories/role.repository';
import { CUSTOM_ROLE_EXCLUDED, PLATFORM_ONLY_PERMISSIONS, USER } from '../constants/permissions';
import type { Queryable } from '../config/pgPool';

const COPIED_ROLES = [USER];

// The platform defaults a company copy starts from. Never the permissions a company role may
// not hold (the database refuses them too: trg_company_role_permission_guard), even if the
// platform owner gave them to USER.
async function defaultsFor(roleName: string): Promise<string[]> {
  const ids = await roleRepository.permissionIds(roleName, { ordered: true });
  return ids.filter((id) => !PLATFORM_ONLY_PERMISSIONS.has(id) && !CUSTOM_ROLE_EXCLUDED.has(id));
}

async function seedForCompany(companyId: number, conn: Queryable): Promise<void> {
  for (const roleName of COPIED_ROLES) {
    await companyRoleRepository.seedBuiltInCopy(companyId, roleName, await defaultsFor(roleName), conn);
  }
}

// Startup: every company has its copies, and every unedited copy matches the defaults.
async function backfillAndSync(): Promise<void> {
  for (const roleName of COPIED_ROLES) {
    const defaults = await defaultsFor(roleName);
    const created = await companyRoleRepository.backfillBuiltInCopies(roleName, defaults);
    if (created) console.log(`[rbac] created the ${roleName} role copy for ${created} company(ies)`);
    await companyRoleRepository.syncUnmodifiedBuiltInCopies(roleName, defaults);
  }
}

// The platform owner saved a built-in role: companies that never edited theirs follow along.
async function followDefaults(roleName: string): Promise<number> {
  if (!COPIED_ROLES.includes(roleName)) return 0;
  return companyRoleRepository.syncUnmodifiedBuiltInCopies(roleName, await defaultsFor(roleName));
}

export { COPIED_ROLES, defaultsFor, seedForCompany, backfillAndSync, followDefaults };
