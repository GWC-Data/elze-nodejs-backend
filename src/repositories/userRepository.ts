import config from '../config';
import { Prisma } from '../generated/prisma/client';
import { pagedRows, companyScope, rawRows } from './baseRepository';
import { likePattern, orderBy } from '../tools/listQuery';
import type { Tx } from '../config/database';
import type { Actor } from '../types/actor';
import type { ListWindow } from './baseRepository';

const { prisma, withTransaction } = config.database;

interface UserFilter {
  companyId?: number;
  role?: string;
  status?: string;
  search?: string;
}

const ROLE_JOIN = Prisma.sql`LEFT JOIN access_control.user_roles ur ON ur.user_id = u.id
       LEFT JOIN access_control.roles r ON r.id = ur.role_id`;

const ROLE_COLUMNS = Prisma.sql`r.tier AS role, ur.role_id, r.name AS role_name, r.kind AS role_kind`;

const USER_COLUMNS = Prisma.sql`u.id, u.company_id, u.username, u.email, u.display_name,
                      (u.password_hash IS NOT NULL) AS has_password,
                      ${ROLE_COLUMNS}, u.status, u.must_change_password,
                      u.last_login_at, u.created_at`;

const USER_SORTS: Record<string, string> = {
  name: 'lower(COALESCE(u.display_name, u.username))',
  company: 'lower(c.name)',
  role: 'r.tier',
  status: 'u.status',
  lastLogin: 'u.last_login_at',
};

async function findByIdentifier(value: string) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${USER_COLUMNS}, u.password_hash,
            c.active AS "companyActive", c.name AS "companyName"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.username = ${value} OR u.email = ${value.toLowerCase()}`
  );
  return rows[0] || null;
}

async function findCredentialsById(id: number) {
  const user = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
  return user ? { password_hash: user.passwordHash } : null;
}

async function findActorRow(id: number) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName",
            COALESCE((SELECT array_agg(e.permission_key ORDER BY e.permission_key)
                        FROM access_control.user_effective_permissions e
                       WHERE e.user_id = u.id AND e.is_effective), '{}') AS permissions,
            COALESCE((SELECT cf.feature_ids FROM access_control.company_features cf
                       WHERE cf.company_id = u.company_id), '{}') AS feature_ids,
            COALESCE((SELECT json_agg(json_build_array(d.key, v.value) ORDER BY d.key, v.value)
                        FROM access_control.user_data_scopes s
                        CROSS JOIN LATERAL jsonb_each(s.scopes) AS d
                        CROSS JOIN LATERAL jsonb_array_elements_text(d.value) AS v(value)
                       WHERE s.user_id = u.id), '[]') AS scopes
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ${id}`
  );
  return rows[0] || null;
}

async function findById(id: number, tx: Tx = prisma) {
  const rows = await rawRows(
    tx,
    Prisma.sql`SELECT ${USER_COLUMNS}, c.active AS "companyActive", c.name AS "companyName"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ${id}`
  );
  return rows[0] || null;
}

async function findInScope(actor: Actor, id: unknown) {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT ${USER_COLUMNS}, c.name AS "companyName"
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${ROLE_JOIN}
      WHERE u.id = ${id} AND ${companyScope(actor, 'u.company_id')}`
  );
  return rows[0] || null;
}

function whereOf(filter: UserFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (filter.companyId !== undefined) conditions.push(Prisma.sql`u.company_id = ${filter.companyId}`);
  if (filter.role) conditions.push(Prisma.sql`r.tier = ${filter.role}`);
  if (filter.status) conditions.push(Prisma.sql`u.status = ${filter.status}`);
  if (filter.search) {
    const pattern = likePattern(filter.search);
    conditions.push(Prisma.sql`(u.username ILIKE ${pattern} OR u.email ILIKE ${pattern} OR u.display_name ILIKE ${pattern})`);
  }
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
}

async function listPage<R>(filter: UserFilter, list: ListWindow, shape: (row: any) => R) {
  const from = Prisma.sql`FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       ${ROLE_JOIN}
      ${whereOf(filter)}`;

  return pagedRows(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, u.display_name, ${ROLE_COLUMNS}, u.status, u.last_login_at,
            c.name AS "companyName", COUNT(*) OVER () AS "__total"
       ${from}
      ${Prisma.raw(orderBy(list, USER_SORTS, 'u.id'))}
      LIMIT ${list.pageSize} OFFSET ${list.offset}`,
    Prisma.sql`SELECT COUNT(*) AS n ${from}`,
    shape
  );
}

async function listOptions(actor: Actor) {
  return prisma.user.findMany({
    where: { status: 'active', ...(actor.isPlatform ? {} : { companyId: actor.companyId as number }) },
    select: { id: true, username: true, email: true },
    orderBy: { username: 'asc' },
  });
}

async function insert(
  { companyId, username, email, displayName, roleId, assignedBy = null }: {
    companyId: number | null;
    username: string;
    email: string;
    displayName: string | null;
    roleId: string;
    assignedBy?: number | null;
  },
  tx?: Tx
): Promise<number> {
  const work = async (client: Tx) => {
    const user = await client.user.create({
      data: { companyId, username, email, displayName, passwordHash: null, status: 'pending', mustChangePassword: false },
      select: { id: true },
    });
    await client.userRole.create({ data: { userId: user.id, roleId, assignedBy } });
    return user.id;
  };
  return tx ? work(tx) : withTransaction(work);
}

async function setRole(userId: number, roleId: string, assignedBy: number | null): Promise<void> {
  await prisma.userRole.upsert({
    where: { userId },
    create: { userId, roleId, assignedBy },
    update: { roleId, assignedBy, assignedAt: new Date() },
  });
}

async function updateColumns(id: number, changes: { displayName?: string | null; status?: string }): Promise<void> {
  if (!Object.keys(changes).length) return;
  await prisma.user.updateMany({ where: { id }, data: changes });
}

async function setActivePassword(tx: Tx, userId: number, passwordHash: string): Promise<void> {
  await tx.user.updateMany({
    where: { id: userId },
    data: { passwordHash, status: 'active', mustChangePassword: false },
  });
}

async function clearCredential(tx: Tx, userId: number): Promise<void> {
  await tx.user.updateMany({
    where: { id: userId },
    data: { status: 'pending', passwordHash: null, mustChangePassword: false },
  });
}

async function recordLogin(userId: number): Promise<void> {
  await prisma.user.updateMany({ where: { id: userId }, data: { lastLoginAt: new Date() } });
}

async function remove(id: number): Promise<boolean> {
  const result = await prisma.user.deleteMany({ where: { id } });
  return result.count > 0;
}

async function countByCompany(companyId: number): Promise<number> {
  return prisma.user.count({ where: { companyId } });
}

export {
  USER_SORTS,
  findByIdentifier,
  findCredentialsById,
  findActorRow,
  findById,
  findInScope,
  listPage,
  listOptions,
  insert,
  setRole,
  updateColumns,
  setActivePassword,
  clearCredential,
  recordLogin,
  remove,
  countByCompany,
};
export type { UserFilter };
