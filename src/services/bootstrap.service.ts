import path from 'path';
import config from '../config';
import * as bootstrapRepository from '../repositories/bootstrap.repository';
import * as dashboardRepository from '../repositories/dashboard.repository';
import * as companyRoleRepository from '../repositories/companyRole.repository';
import { seedExistingCompanies } from './feature.service';
import { backfillAndSync } from './builtInRoles.service';
import { FEATURE_OF_PERMISSION } from '../constants/features';
import { hashPassword } from '../tools/password';
import { normalizeSpec } from '../models/card.model';
import { pruneExpiredTokens } from './token.service';
import { pruneAttempts } from './loginThrottle.service';
import { verifyTransport } from './email.service';
import {
  SYSTEM_ROLES,
  ROLE_NAMES,
  PERMISSION_IDS,
  DEFAULT_ROLE_PERMISSIONS,
  REPLACED_PERMISSIONS,
  SUPER_ADMIN,
  ALL_PERMISSIONS,
  PLATFORM_ONLY_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
} from '../constants/permissions';

const { bootstrapSuperAdmin } = config.auth;
const { DASHBOARD_CONFIG_DIR } = config.env;

const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;

let ready = false;
let readyError: string | null = null;

function isRbacReady(): boolean {
  return ready;
}

function rbacError(): string | null {
  return readyError;
}

async function knownPermissions(): Promise<Set<string>> {
  const logged: string[] = await bootstrapRepository.loggedPermissionIds();
  if (logged.length) return new Set(logged);

  const held: string[] = await bootstrapRepository.heldPermissionIds();
  if (held.length) {
    console.log(`[rbac] recording ${held.length} permission(s) this installation already had`);
  }
  return new Set(held);
}

async function grantAll(roleName: string, permissionIds: readonly string[]): Promise<void> {
  for (const permissionId of permissionIds) {
    await bootstrapRepository.grantRolePermission(roleName, permissionId);
  }
}

// A split permission (context.manage → create/update/publish/delete) hands its holders the
// replacements before the purge removes it, so no role quietly loses access. Idempotent.
async function migrateReplacedPermissions(): Promise<void> {
  for (const [retired, replacements] of Object.entries(REPLACED_PERMISSIONS)) {
    const n = await bootstrapRepository.grantReplacements(retired, replacements);
    await companyRoleRepository.grantReplacements(retired, replacements);
    if (n) console.log(`[rbac] replaced "${retired}" with ${replacements.join(', ')} (${n} grant(s))`);
  }
}

// One-time repairs of role data, each applied once per database and never again - so a later
// deliberate change on the Roles screen is respected.
//
// feature-permissions-v1: running a backend build from before feature toggles against this
// database purges every permission id it does not know (purgePermissionsNotIn) - analyst.*,
// playbook.*, agent.*, context.create/update/publish/delete - while the seed log still says
// they were handed out, so they were never granted again and the Data analyst, Playbooks and
// Agents sidebar items vanished for company roles. This hands the built-in roles back their
// defaults for those features.
//
// new-permissions-v2: the same purge also took role.create/edit/delete (core, so v1 missed them),
// which hid "New role" and the editable Member role from company admins. This one covers every
// permission id introduced with feature toggles and company roles.
const REPAIRS: Array<{ id: string; covers: (permission: string) => boolean }> = [
  {
    id: 'feature-permissions-v1',
    covers: (id) => ['metadata_lakehouse', 'data_analyst', 'agents'].includes(FEATURE_OF_PERMISSION.get(id) || ''),
  },
  {
    id: 'new-permissions-v2',
    covers: (id) =>
      /^(analyst|playbook|agent)\./.test(id) ||
      ['context.create', 'context.update', 'context.publish', 'context.delete',
        'role.create', 'role.edit', 'role.delete'].includes(id),
  },
];

async function applyRepairs(): Promise<void> {
  for (const repair of REPAIRS) {
    if (!(await bootstrapRepository.claimRepair(repair.id))) continue;
    for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const owned = permissions.filter(repair.covers);
      await grantAll(roleName, owned);
      console.log(`[rbac] repair ${repair.id}: ensured ${owned.length} default permission(s) for ${roleName}`);
    }
  }
}

// The catalogue as the database mirrors it (models/rbac.model.ts `permissions`).
const CATALOGUE_ROWS = ALL_PERMISSIONS.map((p) => ({
  id: p.id,
  feature: FEATURE_OF_PERMISSION.get(p.id) || null,
  platformOnly: PLATFORM_ONLY_PERMISSIONS.has(p.id),
  adminOnly: CUSTOM_ROLE_EXCLUDED.has(p.id),
}));

// Company roles and every company's Member copy, once the shared roles are seeded:
//   1. one-time - copies that exist before per-company seeding were all made by an admin's
//      edit, so they are marked as that company's own version;
//   2. every company gets its Member copy, and unedited copies follow the platform defaults;
//   3. retired permission ids leave the catalogue;
//   4. the database-level guarantees (INTEGRITY) are added once the data fits them.
async function seedCompanyRoles(): Promise<void> {
  if (await bootstrapRepository.claimRepair('builtin-copies-modified-v1')) {
    const marked = await companyRoleRepository.markExistingBuiltInCopiesModified();
    if (marked) console.log(`[rbac] kept ${marked} company-edited Member role(s) as their company's own`);
  }
  await backfillAndSync();
  await bootstrapRepository.prunePermissionCatalogue(PERMISSION_IDS);
  await bootstrapRepository.createRbacIntegrity();
}

async function seedRoles(): Promise<void> {
  const created = new Set<string>();
  const alreadyKnown = await knownPermissions();

  // Before any grant: company-role rows may only hold ids the catalogue table knows.
  await bootstrapRepository.upsertPermissionCatalogue(CATALOGUE_ROWS);

  await migrateReplacedPermissions();

  for (const role of SYSTEM_ROLES) {
    if (await bootstrapRepository.upsertRole(role)) created.add(role.name);
  }

  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (!created.has(roleName)) continue;
    await grantAll(roleName, permissions);
    console.log(`[rbac] seeded ${permissions.length} default permissions for ${roleName}`);
  }

  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (created.has(roleName)) continue;
    const added = permissions.filter((id) => !alreadyKnown.has(id));
    if (!added.length) continue;
    await grantAll(roleName, added);
    console.log(
      `[rbac] granted ${roleName} ${added.length} newly added permission(s): ${added.join(', ')}`
    );
  }

  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await grantAll(roleName, permissions.filter((id) => id.startsWith('dashboard.')));
  }

  await applyRepairs();

  for (const permissionId of PERMISSION_IDS) {
    await bootstrapRepository.logPermission(permissionId);
  }

  const purged = await bootstrapRepository.purgePermissionsNotIn(PERMISSION_IDS);
  const purgedCustom = await companyRoleRepository.purgePermissionsNotIn(PERMISSION_IDS);
  if (purged || purgedCustom) {
    console.log(`[rbac] removed ${(purged || 0) + purgedCustom} permission row(s) no longer in the catalogue`);
  }

  for (const name of await bootstrapRepository.rolesNotIn(ROLE_NAMES)) {
    const holders = await bootstrapRepository.countUsersWithRole(name);
    if (holders > 0) {
      throw new Error(
        `Role "${name}" is not part of the three-role model but ${holders} account(s) still hold it. ` +
        `Reassign them to one of ${ROLE_NAMES.join(', ')} before starting the server.`
      );
    }
    await bootstrapRepository.deleteRole(name);
    console.log(`[rbac] removed unused role "${name}"`);
  }
}

async function seedSuperAdmin(): Promise<boolean> {
  if ((await bootstrapRepository.countUsers()) > 0) return false;

  const { username, email, password } = bootstrapSuperAdmin();
  await bootstrapRepository.insertSuperAdmin({
    username,
    email: String(email).toLowerCase(),
    passwordHash: hashPassword(password),
    role: SUPER_ADMIN,
  });
  console.log(
    `[rbac] seeded platform owner "${username}" as ${SUPER_ADMIN}, ` +
    'flagged to change its password at first sign-in'
  );
  return true;
}

async function seedDefaultDashboards(): Promise<void> {
  if (!dashboardRepository.fileExists(DASHBOARD_CONFIG_DIR)) return;
  let files: string[] = [];
  try {
    files = dashboardRepository.listJsonFiles(DASHBOARD_CONFIG_DIR);
  } catch (_) {
    return;
  }

  for (const file of files) {
    try {
      const id = path.basename(file, '.json');
      const spec = normalizeSpec(dashboardRepository.readJsonFile(path.join(DASHBOARD_CONFIG_DIR, file)));
      await bootstrapRepository.insertDashboardIfMissing({
        id,
        title: spec.title || id,
        description: spec.description || null,
        spec,
      });
    } catch (err: any) {
      console.warn(`[rbac] failed to seed dashboard from ${file}:`, err.message);
    }
  }
}

async function bootstrapAppMeta(): Promise<boolean> {
  try {
    await bootstrapRepository.createRbacSchema();
    await seedRoles();
    await seedExistingCompanies();
    await seedCompanyRoles();
    await seedSuperAdmin();
    await seedDefaultDashboards();
    await bootstrapRepository.createContextSchema();

    ready = true;
    readyError = null;
    return true;
  } catch (err: any) {
    ready = false;
    readyError = err.message;
    throw err;
  }
}

async function bootstrapWithRetry(attempts: number = 5, delayMs: number = 3000): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await bootstrapAppMeta();
      console.log('[rbac] metadata database ready');
      return;
    } catch (err: any) {
      const last = attempt === attempts;
      console.warn(
        `[rbac] bootstrap failed (${err.code || err.message})` +
        (last ? '' : `, retrying in ${delayMs / 1000}s...`)
      );
      if (last) {
        console.error('[rbac] giving up. The metadata database must be reachable to serve any request.');
        console.error(`[rbac] last error: ${err.message}`);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function verifyEmailTransport(): Promise<void> {
  try {
    await verifyTransport();
    console.log('[email] SMTP relay reachable and credentials accepted');
  } catch (err: any) {
    console.warn(
      `[email] SMTP is not usable: ${err.message}. Creating a user will fail until this is fixed.`
    );
  }
}

function startHousekeeping(): NodeJS.Timeout {
  const runOnce = async () => {
    try {
      const tokens = await pruneExpiredTokens();
      const attempts = await pruneAttempts();
      if (tokens || attempts) {
        console.log(`[housekeeping] pruned ${tokens} token row(s), ${attempts} login-attempt row(s)`);
      }
    } catch (err: any) {
      console.warn('[housekeeping] prune failed:', err.message);
    }
  };
  void runOnce();
  return setInterval(runOnce, HOUSEKEEPING_INTERVAL_MS).unref();
}

export {
  isRbacReady,
  rbacError,
  bootstrapAppMeta,
  bootstrapWithRetry,
  verifyEmailTransport,
  startHousekeeping,
};
