import crypto from 'crypto';
import config from '../config';
import * as migrationRepository from '../repositories/accessMigrationRepository';
import * as bootstrapRepository from '../repositories/bootstrapRepository';
import { seedCatalogue } from './accessCatalogueService';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_KEYS,
  REPLACED_PERMISSIONS,
  SUPER_ADMIN,
  USER,
  SYSTEM_ROLE_ID,
  permissionIdsOf,
} from '../constants/permissions';
import {
  FEATURE_KEYS,
  effectiveFeatures,
  featureIdsOf,
  featureKeysOf,
  maskPermissions,
} from '../constants/features';
import type { Queryable } from '../config/pgPool';

const { withTransaction } = config.database;

const MIGRATION_ID = 'uuid-rbac-v1';

interface AccessSnapshot {
  role: string | null;
  permissions: string[];
  features: string[];
}

function expandReplaced(keys: readonly string[]): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    out.add(key);
    for (const replacement of REPLACED_PERMISSIONS[key] || []) out.add(replacement);
  }
  return [...out].filter((key) => ALL_PERMISSION_KEYS.has(key));
}

function snapshotOf(role: string | null, companyId: number | null, held: readonly string[], storedFeatures: readonly string[]): AccessSnapshot {
  const features = companyId ? effectiveFeatures(storedFeatures) : [...FEATURE_KEYS];
  const known = held.filter((key) => ALL_PERMISSION_KEYS.has(key));
  const permissions = companyId ? maskPermissions(known, features) : known;
  return { role, permissions: [...permissions].sort(), features: [...features].sort() };
}

function legacySnapshot(context: Awaited<ReturnType<typeof readLegacy>>): Map<number, AccessSnapshot> {
  const { users, rolePermissions, companyRoles, companyFeatures } = context;
  const customById = new Map(companyRoles.filter((r: any) => !r.builtin_role).map((r: any) => [r.id, r.keys as string[]]));
  const copyByCompany = new Map(
    companyRoles.filter((r: any) => r.builtin_role === USER).map((r: any) => [r.company_id, r.keys as string[]])
  );
  const featuresByCompany = new Map(companyFeatures.map((c) => [c.id, c.keys]));

  const out = new Map<number, AccessSnapshot>();
  for (const user of users) {
    let held: string[];
    if (user.role === SUPER_ADMIN) held = [...PERMISSION_KEYS];
    else if (user.custom_role_id && user.role === USER) held = customById.get(user.custom_role_id) || [];
    else if (user.role === USER && user.company_id && copyByCompany.has(user.company_id)) held = copyByCompany.get(user.company_id)!;
    else held = rolePermissions.get(user.role) || [];
    out.set(user.id, snapshotOf(user.role, user.company_id, held, featuresByCompany.get(user.company_id!) || []));
  }
  return out;
}

async function readLegacy(conn: Queryable) {
  const users = await migrationRepository.legacyUsers(conn);
  const rolePermissions = await migrationRepository.legacyRolePermissions(conn);
  const companyRoles = await migrationRepository.legacyCompanyRoles(conn);
  const companyFeatures = await migrationRepository.legacyCompanyFeatures(conn);
  return { users, rolePermissions, companyRoles, companyFeatures };
}

function describeDifference(before: AccessSnapshot | undefined, after: AccessSnapshot | undefined): string | null {
  if (!before || !after) return 'missing from one side';
  if (before.role !== after.role) return `role ${before.role} became ${after.role}`;
  const lost = before.permissions.filter((p) => !after.permissions.includes(p));
  const gained = after.permissions.filter((p) => !before.permissions.includes(p));
  if (lost.length || gained.length) return `permissions lost [${lost.join(', ')}] gained [${gained.join(', ')}]`;
  const lostFeatures = before.features.filter((f) => !after.features.includes(f));
  const gainedFeatures = after.features.filter((f) => !before.features.includes(f));
  if (lostFeatures.length || gainedFeatures.length) {
    return `features lost [${lostFeatures.join(', ')}] gained [${gainedFeatures.join(', ')}]`;
  }
  return null;
}

async function copyLegacy(conn: Queryable, legacy: Awaited<ReturnType<typeof readLegacy>>): Promise<Array<[number, string]>> {
  const { users, rolePermissions, companyRoles, companyFeatures } = legacy;

  await bootstrapRepository.setRolePermissions(SYSTEM_ROLE_ID[SUPER_ADMIN], permissionIdsOf(PERMISSION_KEYS), conn);
  for (const [roleName, keys] of rolePermissions) {
    const roleId = SYSTEM_ROLE_ID[roleName];
    if (!roleId || roleName === SUPER_ADMIN) continue;
    await migrationRepository.setRolePermissions(conn, roleId, permissionIdsOf(expandReplaced(keys)));
  }

  const roleMap: Array<[number, string]> = [];
  const customNames = new Set(
    companyRoles.filter((r: any) => !r.builtin_role).map((r: any) => `${r.company_id}:${String(r.name).toLowerCase()}`)
  );
  for (const r of companyRoles) {
    const id = crypto.randomUUID();
    const isDefault = Boolean(r.builtin_role);
    const defaultName = customNames.has(`${r.company_id}:member`) ? 'Member (built-in)' : 'Member';
    await migrationRepository.insertRole(conn, {
      id,
      companyId: r.company_id,
      kind: isDefault ? 'company_default' : 'custom',
      name: isDefault ? defaultName : r.name,
      description: r.description,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      modifiedBy: r.modified_by,
      modifiedAt: r.modified_at,
    });
    await migrationRepository.setRolePermissions(conn, id, permissionIdsOf(expandReplaced(r.keys)));
    roleMap.push([r.id, id]);
  }
  const roleIdOf = new Map(roleMap);
  const defaultRoleOf = new Map(
    companyRoles.filter((r: any) => r.builtin_role === USER).map((r: any) => [r.company_id, roleIdOf.get(r.id)!])
  );

  for (const c of companyFeatures) {
    if (!c.seeded) continue;
    await migrationRepository.insertCompanyFeatures(conn, c.id, featureIdsOf(c.keys));
  }

  for (const user of users) {
    let roleId: string | undefined;
    if (user.role === USER && user.custom_role_id) roleId = roleIdOf.get(user.custom_role_id);
    else if (user.role === USER && user.company_id) roleId = defaultRoleOf.get(user.company_id) || SYSTEM_ROLE_ID[USER];
    else roleId = SYSTEM_ROLE_ID[user.role];
    if (!roleId) throw new Error(`User ${user.id} holds role "${user.role}" that has no place in the new model.`);
    await migrationRepository.insertUserRole(conn, user.id, roleId);
  }

  const scopes = await migrationRepository.copyDataScopes(conn);
  if (scopes) console.log(`[rbac] migrated data scopes of ${scopes} user(s)`);

  const grants = await migrationRepository.copyGrants(conn);
  for (const [table, { legacy: n, copied }] of Object.entries(grants)) {
    if (copied !== n) {
      console.warn(`[rbac] ${table}: copied ${copied} of ${n} row(s); the rest pointed at dashboards that no longer exist`);
    }
  }

  await migrationRepository.markDefaultsApplied(conn, await migrationRepository.knownPermissionKeys(conn));
  return roleMap;
}

async function migrateLegacyAccessControl(): Promise<boolean> {
  return withTransaction(async (conn: Queryable) => {
    await migrationRepository.lock(conn);
    if (!(await migrationRepository.needsMigration(conn))) return false;

    console.log('[rbac] moving roles, permissions and access to the access_control schema (one time)');
    const legacy = await readLegacy(conn);
    const before = legacySnapshot(legacy);

    await bootstrapRepository.createAccessControlSchema(conn);
    await seedCatalogue(conn);
    const roleMap = await copyLegacy(conn, legacy);
    await bootstrapRepository.createAccessControlViews(conn);

    const after = new Map<number, AccessSnapshot>();
    for (const row of await migrationRepository.effectiveAccess(conn)) {
      after.set(row.id, snapshotOf(row.role, row.company_id, row.permissions, featureKeysOf(row.feature_ids)));
    }
    const problems = [...before.keys()]
      .map((id) => [id, describeDifference(before.get(id), after.get(id))] as const)
      .filter(([, problem]) => problem);
    if (problems.length) {
      const detail = problems.map(([id, problem]) => `user ${id}: ${problem}`).join('; ');
      throw new Error(`access would change for ${problems.length} user(s), nothing was migrated: ${detail}`);
    }

    const moved = await migrationRepository.retireLegacyTables(conn, roleMap);
    await bootstrapRepository.claimRepair(MIGRATION_ID, conn);
    console.log(
      `[rbac] migrated ${before.size} user(s) with identical access; old tables kept in legacy_rbac: ${moved.join(', ')}`
    );
    return true;
  });
}

export { migrateLegacyAccessControl };
