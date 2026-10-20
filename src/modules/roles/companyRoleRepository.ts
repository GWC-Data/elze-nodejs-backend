import crypto from 'node:crypto';
import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import type { Tx } from '../../shared/db/database';

const { prisma, withTransaction } = config.database;

const COMPANY_DEFAULT_NAME = 'Member';

interface CompanyRoleRow {
  id: string;
  companyId: number;
  kind: string;
  tier: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  modifiedAt: Date | null;
  modifiedBy: string | null;
  permissionIds: string[];
  userCount: number;
}

const ROLE_COLUMNS = Prisma.sql`r.id, r.company_id AS "companyId", r.kind, r.tier, r.name, r.description,
                      r.created_at AS "createdAt", r.updated_at AS "updatedAt",
                      r.modified_at AS "modifiedAt",
                      (SELECT mu.username FROM users mu WHERE mu.id = r.modified_by) AS "modifiedBy",
                      COALESCE((SELECT rp.permission_ids FROM access_control.role_permissions rp WHERE rp.role_id = r.id), '{}')
                        AS "permissionIds",
                      (SELECT COUNT(*) FROM access_control.user_roles ur WHERE ur.role_id = r.id) AS "userCount"`;

async function writePermissions(tx: Tx, roleId: string, ids: readonly string[], actorId: number | null) {
  await tx.rolePermissions.upsert({
    where: { roleId },
    create: { roleId, permissionIds: [...ids], updatedBy: actorId },
    update: { permissionIds: [...ids], updatedBy: actorId, updatedAt: new Date() },
  });
}

async function listForCompany(companyId: number): Promise<CompanyRoleRow[]> {
  return rawRows<CompanyRoleRow>(
    prisma,
    Prisma.sql`SELECT ${ROLE_COLUMNS} FROM access_control.roles r
      WHERE r.company_id = ${companyId} AND r.kind = 'custom'
      ORDER BY lower(r.name), r.created_at`
  );
}

async function builtInCounts(companyId: number): Promise<Record<string, number>> {
  const rows = await rawRows<{ tier: string; n: number }>(
    prisma,
    Prisma.sql`SELECT r.tier, COUNT(*) AS n
       FROM users u
       JOIN access_control.user_roles ur ON ur.user_id = u.id
       JOIN access_control.roles r ON r.id = ur.role_id
      WHERE u.company_id = ${companyId} AND r.kind <> 'custom'
      GROUP BY r.tier`
  );
  return Object.fromEntries(rows.map((r) => [r.tier, Number(r.n)]));
}

async function findInCompany(id: string, companyId: number | null): Promise<CompanyRoleRow | null> {
  const company = companyId === null ? Prisma.empty : Prisma.sql`AND r.company_id = ${companyId}`;
  const rows = await rawRows<CompanyRoleRow>(
    prisma,
    Prisma.sql`SELECT ${ROLE_COLUMNS} FROM access_control.roles r
      WHERE r.id = ${id}::uuid AND r.kind = 'custom' ${company}`
  );
  return rows[0] || null;
}

async function insert({
  companyId,
  name,
  description,
  permissionIds,
  createdBy,
}: {
  companyId: number;
  name: string;
  description: string | null;
  permissionIds: readonly string[];
  createdBy: number;
}): Promise<string> {
  return withTransaction(async (tx) => {
    const id = crypto.randomUUID();
    await tx.role.create({ data: { id, companyId, kind: 'custom', tier: 'USER', name, description, createdBy } });
    await writePermissions(tx, id, permissionIds, createdBy);
    return id;
  });
}

async function update(
  id: string,
  {
    name,
    description,
    permissionIds,
  }: { name?: string; description?: string | null; permissionIds?: readonly string[] },
  actorId: number
): Promise<void> {
  await withTransaction(async (tx) => {
    const now = new Date();
    await tx.role.updateMany({
      where: { id },
      data: {
        updatedAt: now,
        modifiedAt: now,
        modifiedBy: actorId,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
    if (permissionIds !== undefined) await writePermissions(tx, id, permissionIds, actorId);
  });
}

async function findCompanyDefault(companyId: number, tx: Tx = prisma): Promise<CompanyRoleRow | null> {
  const rows = await rawRows<CompanyRoleRow>(
    tx,
    Prisma.sql`SELECT ${ROLE_COLUMNS} FROM access_control.roles r
      WHERE r.company_id = ${companyId} AND r.kind = 'company_default' AND r.tier = 'USER'`
  );
  return rows[0] || null;
}

async function ensureCompanyDefault(tx: Tx, companyId: number, actorId: number | null) {
  const [row] = await rawRows<{ id: string; inserted: boolean }>(
    tx,
    Prisma.sql`INSERT INTO access_control.roles (id, company_id, kind, tier, name, created_by)
     VALUES (${crypto.randomUUID()}::uuid, ${companyId}, 'company_default', 'USER', ${COMPANY_DEFAULT_NAME}, ${actorId}::int)
     ON CONFLICT (company_id, tier) WHERE kind = 'company_default'
       DO UPDATE SET updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`
  );
  return row;
}

async function seedCompanyDefault(companyId: number, permissionIds: readonly string[], tx?: Tx): Promise<boolean> {
  const work = async (client: Tx) => {
    const row = await ensureCompanyDefault(client, companyId, null);
    if (row.inserted) await writePermissions(client, row.id, permissionIds, null);
    return row.inserted;
  };
  return tx ? work(tx) : withTransaction(work);
}

async function saveCompanyDefault(companyId: number, permissionIds: readonly string[], actorId: number): Promise<void> {
  await withTransaction(async (tx) => {
    const row = await ensureCompanyDefault(tx, companyId, actorId);
    const now = new Date();
    await tx.role.update({ where: { id: row.id }, data: { modifiedBy: actorId, modifiedAt: now, updatedAt: now } });
    await writePermissions(tx, row.id, permissionIds, actorId);
  });
}

async function resetCompanyDefault(
  companyId: number,
  permissionIds: readonly string[],
  actorId: number
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const row = await ensureCompanyDefault(tx, companyId, null);
    const before = await tx.role.findUnique({ where: { id: row.id }, select: { modifiedAt: true } });
    await tx.role.update({
      where: { id: row.id },
      data: { modifiedBy: null, modifiedAt: null, updatedAt: new Date() },
    });
    await writePermissions(tx, row.id, permissionIds, actorId);
    return Boolean(before?.modifiedAt);
  });
}

async function syncUnmodifiedCompanyDefaults(permissionIds: readonly string[]): Promise<number> {
  return withTransaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO access_control.role_permissions AS rp (role_id, permission_ids)
      SELECT r.id, ${[...permissionIds]}::uuid[] FROM access_control.roles r
       WHERE r.kind = 'company_default' AND r.tier = 'USER' AND r.modified_at IS NULL
      ON CONFLICT (role_id) DO UPDATE SET permission_ids = EXCLUDED.permission_ids, updated_at = now()
        WHERE NOT (rp.permission_ids @> EXCLUDED.permission_ids AND rp.permission_ids <@ EXCLUDED.permission_ids)`;
    return tx.role.count({ where: { kind: 'company_default', tier: 'USER', modifiedAt: null } });
  });
}

async function remove(id: string): Promise<boolean> {
  const result = await prisma.role.deleteMany({ where: { id, kind: 'custom' } });
  return result.count > 0;
}

export {
  COMPANY_DEFAULT_NAME,
  listForCompany,
  builtInCounts,
  findInCompany,
  insert,
  update,
  remove,
  findCompanyDefault,
  seedCompanyDefault,
  saveCompanyDefault,
  resetCompanyDefault,
  syncUnmodifiedCompanyDefaults,
};
export type { CompanyRoleRow };
