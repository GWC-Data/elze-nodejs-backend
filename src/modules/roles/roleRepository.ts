import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';
import type { Tx } from '../../shared/db/database';

const { prisma } = config.database;

async function findSystemRole(id: string) {
  const role = await prisma.role.findFirst({
    where: { id, kind: 'system' },
    include: { permissions: { select: { permissionIds: true, updatedAt: true } } },
  });
  if (!role) return null;
  return {
    id: role.id,
    tier: role.tier,
    name: role.name,
    description: role.description,
    permissionIds: role.permissions ? role.permissions.permissionIds : [],
    updatedAt: role.permissions ? role.permissions.updatedAt : null,
  };
}

async function permissionIds(roleId: string, tx: Tx = prisma): Promise<string[]> {
  const row = await tx.rolePermissions.findUnique({ where: { roleId }, select: { permissionIds: true } });
  return row ? row.permissionIds : [];
}

async function listSystemWithCounts() {
  return rawRows(
    prisma,
    Prisma.sql`SELECT r.id, r.tier, r.name, r.description,
            (SELECT COUNT(*)::int FROM access_control.user_roles ur
               JOIN access_control.roles held ON held.id = ur.role_id
              WHERE held.tier = r.tier) AS "userCount"
       FROM access_control.roles r
      WHERE r.kind = 'system'
      ORDER BY CASE r.tier WHEN 'SUPER_ADMIN' THEN 0 WHEN 'COMPANY_ADMIN' THEN 1 ELSE 2 END`
  );
}

async function replacePermissions(roleId: string, ids: readonly string[], actorId: number | null): Promise<void> {
  await prisma.rolePermissions.upsert({
    where: { roleId },
    create: { roleId, permissionIds: [...ids], updatedBy: actorId },
    update: { permissionIds: [...ids], updatedBy: actorId, updatedAt: new Date() },
  });
}

export { findSystemRole, permissionIds, listSystemWithCounts, replacePermissions };
