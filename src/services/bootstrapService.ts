import path from 'path';
import config from '../config';
import * as bootstrapRepository from '../repositories/bootstrapRepository';
import * as dashboardRepository from '../repositories/dashboardRepository';
import * as companyRoleRepository from '../repositories/companyRoleRepository';
import { seedExistingCompanies } from './featureService';
import { backfillAndSync } from './builtInRolesService';
import { seedCatalogue } from './accessCatalogueService';
import { migrateLegacyAccessControl } from './accessMigrationService';
import { FEATURES, FEATURE_OF_PERMISSION } from '../constants/features';
import { ACCESS_LEVEL_CATALOGUE } from '../constants/accessLevels';
import { hashPassword } from '../tools/password';
import { normalizeSpec } from '../models/cardModel';
import { pruneExpiredTokens } from './tokenService';
import { pruneAttempts } from './loginThrottleService';
import { verifyTransport } from './emailService';
import {
  ALL_PERMISSIONS,
  PERMISSION_BY_KEY,
  SYSTEM_ROLES,
  SYSTEM_ROLE_ID,
  DEFAULT_ROLE_PERMISSIONS,
  REPLACED_PERMISSIONS,
  SUPER_ADMIN,
  permissionIdsOf,
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

async function grantAll(roleName: string, keys: readonly string[]): Promise<void> {
  await bootstrapRepository.addRolePermissions(SYSTEM_ROLE_ID[roleName], permissionIdsOf(keys));
}

async function migrateReplacedPermissions(): Promise<void> {
  for (const [retired, replacements] of Object.entries(REPLACED_PERMISSIONS)) {
    const n = await bootstrapRepository.grantReplacements(retired, permissionIdsOf(replacements));
    if (n) console.log(`[rbac] replaced "${retired}" with ${replacements.join(', ')} (${n} role(s) or person(s))`);
  }
}

const REPAIRS: Array<{ id: string; covers: (permission: string) => boolean }> = [
  {
    id: 'feature-permissions-v1',
    covers: (key) => ['metadata_lakehouse', 'data_analyst', 'agents'].includes(FEATURE_OF_PERMISSION.get(key) || ''),
  },
  {
    id: 'new-permissions-v2',
    covers: (key) =>
      /^(analyst|playbook|agent)\./.test(key) ||
      ['context.create', 'context.update', 'context.publish', 'context.delete',
        'role.create', 'role.edit', 'role.delete'].includes(key),
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

async function seedCompanyRoles(): Promise<void> {
  if (await bootstrapRepository.claimRepair('builtin-copies-modified-v1')) {
    const marked = await companyRoleRepository.markExistingCompanyDefaultsModified();
    if (marked) console.log(`[rbac] kept ${marked} company-edited Member role(s) as their company's own`);
  }
  await backfillAndSync();
}

async function seedRoles(): Promise<void> {
  const created = await seedCatalogue();
  const newIds = new Set(await bootstrapRepository.newPermissionIds());

  await migrateReplacedPermissions();

  await bootstrapRepository.setRolePermissions(SYSTEM_ROLE_ID[SUPER_ADMIN], ALL_PERMISSIONS.map((p) => p.id));

  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (created.has(roleName)) {
      await grantAll(roleName, permissions);
      console.log(`[rbac] seeded ${permissions.length} default permissions for ${roleName}`);
      continue;
    }
    const added = permissions.filter((key) => newIds.has(PERMISSION_BY_KEY.get(key)?.id || ''));
    if (!added.length) continue;
    await grantAll(roleName, added);
    console.log(`[rbac] granted ${roleName} ${added.length} newly added permission(s): ${added.join(', ')}`);
  }

  for (const [roleName, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    await grantAll(roleName, permissions.filter((key) => key.startsWith('dashboard.')));
  }

  await applyRepairs();
  await bootstrapRepository.markDefaultsApplied();

  const pruned = await bootstrapRepository.pruneCatalogue({
    permissionIds: ALL_PERMISSIONS.map((p) => p.id),
    featureIds: FEATURES.map((f) => f.id),
    accessLevelIds: ACCESS_LEVEL_CATALOGUE.map((l) => l.id),
  });
  if (pruned.permissions || pruned.features) {
    console.log(`[rbac] removed ${pruned.permissions} permission(s) and ${pruned.features} feature(s) no longer in the catalogue`);
  }

  for (const role of await bootstrapRepository.unknownSystemRoles(SYSTEM_ROLES.map((r) => r.id))) {
    if (role.holders > 0) {
      throw new Error(
        `Role "${role.name}" is not part of the three-role model but ${role.holders} account(s) still hold it. ` +
        `Reassign them to one of ${SYSTEM_ROLES.map((r) => r.name).join(', ')} before starting the server.`
      );
    }
    await bootstrapRepository.deleteRole(role.id);
    console.log(`[rbac] removed unused role "${role.name}"`);
  }
}

async function seedSuperAdmin(): Promise<boolean> {
  if ((await bootstrapRepository.countUsers()) > 0) return false;

  const { username, email, password } = bootstrapSuperAdmin();
  await bootstrapRepository.insertSuperAdmin({
    username,
    email: String(email).toLowerCase(),
    passwordHash: hashPassword(password),
    roleId: SYSTEM_ROLE_ID[SUPER_ADMIN],
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
    await bootstrapRepository.createCoreSchema();
    await bootstrapRepository.createContextSchema();
    await migrateLegacyAccessControl();
    await bootstrapRepository.createAccessControlSchema();
    await seedRoles();
    await seedExistingCompanies();
    await seedCompanyRoles();
    await seedSuperAdmin();
    await seedDefaultDashboards();
    await bootstrapRepository.createAccessControlViews();

    const roleless = await bootstrapRepository.countUsersWithoutRole();
    if (roleless) console.warn(`[rbac] ${roleless} account(s) have no role in access_control.user_roles and cannot sign in`);

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
