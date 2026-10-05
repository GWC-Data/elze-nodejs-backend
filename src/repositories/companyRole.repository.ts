import config from '../config';
import { T } from '../models/rbac.model';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;

const ROLE_COLUMNS = `r.id, r.company_id AS "companyId", r.name, r.description,
                      r.created_at AS "createdAt", r.updated_at AS "updatedAt",
                      r.modified_at AS "modifiedAt",
                      (SELECT mu.username FROM ${T.users} mu WHERE mu.id = r.modified_by) AS "modifiedBy",
                      COALESCE((SELECT array_agg(p.permission_id ORDER BY p.permission_id)
                                  FROM ${T.companyRolePermissions} p WHERE p.role_id = r.id), '{}') AS permissions,
                      (SELECT COUNT(*) FROM ${T.users} u WHERE u.custom_role_id = r.id) AS "userCount"`;

async function listForCompany(companyId: number) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.companyRoles} r
      WHERE r.company_id = ? AND r.builtin_role IS NULL
      ORDER BY lower(r.name), r.id`,
    [companyId]
  );
  return rows;
}

// Members per built-in role in one company, counting only those WITHOUT a custom role - a
// member with one is shown under that role instead.
async function builtInCounts(companyId: number): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT role, COUNT(*) AS n FROM ${T.users}
      WHERE company_id = ? AND custom_role_id IS NULL GROUP BY role`,
    [companyId]
  );
  return Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]));
}

// Company-scoped in SQL: a role in another company is simply not found.
async function findInCompany(id: number, companyId: number | null) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.companyRoles} r
      WHERE r.id = ? AND r.builtin_role IS NULL${companyId === null ? '' : ' AND r.company_id = ?'}`,
    companyId === null ? [id] : [id, companyId]
  );
  return rows[0] || null;
}

async function writePermissions(conn: Queryable, roleId: number, permissions: readonly string[]) {
  await conn.query(`DELETE FROM ${T.companyRolePermissions} WHERE role_id = ?`, [roleId]);
  if (permissions.length) {
    await conn.query(
      `INSERT INTO ${T.companyRolePermissions} (role_id, permission_id)
       SELECT ?, p FROM unnest(?::text[]) AS p`,
      [roleId, permissions]
    );
  }
}

async function insert(
  { companyId, name, description, permissions, createdBy }: {
    companyId: number;
    name: string;
    description: string | null;
    permissions: readonly string[];
    createdBy: number;
  }
): Promise<number> {
  return withTransaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `INSERT INTO ${T.companyRoles} (company_id, name, description, created_by)
       VALUES (?, ?, ?, ?) RETURNING id`,
      [companyId, name, description, createdBy]
    );
    await writePermissions(conn, rows[0].id, permissions);
    return rows[0].id;
  });
}

async function update(
  id: number,
  { name, description, permissions }: { name?: string; description?: string | null; permissions?: readonly string[] },
  actorId: number
): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    const sets: string[] = ['updated_at = now()', 'modified_at = now()', 'modified_by = ?'];
    const params: unknown[] = [actorId];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    await conn.query(`UPDATE ${T.companyRoles} SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (permissions !== undefined) await writePermissions(conn, id, permissions);
  });
}

// ----------------------------------------------------------- built-in role overrides

async function findBuiltInOverride(companyId: number, roleName: string) {
  const { rows } = await db.query(
    `SELECT ${ROLE_COLUMNS} FROM ${T.companyRoles} r WHERE r.company_id = ? AND r.builtin_role = ?`,
    [companyId, roleName]
  );
  return rows[0] || null;
}

// Named after the role it copies: a custom role can never take a built-in name
// (companyRole.service parseName), so this cannot collide with uq_company_roles_name.
async function ensureBuiltInRow(conn: Queryable, companyId: number, roleName: string, actorId: number | null) {
  const { rows } = await conn.query(
    `INSERT INTO ${T.companyRoles} (company_id, name, builtin_role, created_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (company_id, builtin_role) WHERE builtin_role IS NOT NULL
       DO UPDATE SET updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [companyId, roleName, roleName, actorId]
  );
  return rows[0] as { id: number; inserted: boolean };
}

// A company's first copy - at company creation (inside its transaction) or a startup backfill.
// Never touches an existing copy.
async function seedBuiltInCopy(
  companyId: number,
  roleName: string,
  permissions: readonly string[],
  conn?: Queryable
): Promise<boolean> {
  const work = async (client: Queryable) => {
    const row = await ensureBuiltInRow(client, companyId, roleName, null);
    if (row.inserted) await writePermissions(client, row.id, permissions);
    return row.inserted;
  };
  return conn ? work(conn) : withTransaction(work);
}

// The company admin's edit: the copy becomes the company's own (modified_* set), and the
// platform owner's later default changes no longer reach it.
async function saveBuiltInCopy(
  companyId: number,
  roleName: string,
  permissions: readonly string[],
  actorId: number
): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    const row = await ensureBuiltInRow(conn, companyId, roleName, actorId);
    await conn.query(
      `UPDATE ${T.companyRoles} SET modified_by = ?, modified_at = now(), updated_at = now() WHERE id = ?`,
      [actorId, row.id]
    );
    await writePermissions(conn, row.id, permissions);
  });
}

// Back to the platform defaults: the copy follows them again from now on.
async function resetBuiltInCopy(companyId: number, roleName: string, permissions: readonly string[]): Promise<boolean> {
  return withTransaction(async (conn: Queryable) => {
    const row = await ensureBuiltInRow(conn, companyId, roleName, null);
    const { rows } = await conn.query(`SELECT modified_at FROM ${T.companyRoles} WHERE id = ?`, [row.id]);
    await conn.query(
      `UPDATE ${T.companyRoles} SET modified_by = NULL, modified_at = NULL, updated_at = now() WHERE id = ?`,
      [row.id]
    );
    await writePermissions(conn, row.id, permissions);
    return Boolean(rows[0] && rows[0].modified_at);
  });
}

// Every company that has no copy yet gets one; returns how many were created.
async function backfillBuiltInCopies(roleName: string, permissions: readonly string[]): Promise<number> {
  return withTransaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `INSERT INTO ${T.companyRoles} (company_id, name, builtin_role)
       SELECT c.id, ?, ? FROM ${T.companies} c
        WHERE NOT EXISTS (SELECT 1 FROM ${T.companyRoles} r WHERE r.company_id = c.id AND r.builtin_role = ?)
       RETURNING id`,
      [roleName, roleName, roleName]
    );
    for (const row of rows) await writePermissions(conn, row.id, permissions);
    return rows.length;
  });
}

// Copies no company has edited follow the platform defaults: rewrite them all to `permissions`.
async function syncUnmodifiedBuiltInCopies(roleName: string, permissions: readonly string[]): Promise<number> {
  return withTransaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `SELECT id FROM ${T.companyRoles} WHERE builtin_role = ? AND modified_at IS NULL`,
      [roleName]
    );
    const ids = rows.map((r) => r.id);
    if (!ids.length) return 0;
    await conn.query(`DELETE FROM ${T.companyRolePermissions} WHERE role_id = ANY(?::int[])`, [ids]);
    if (permissions.length) {
      await conn.query(
        `INSERT INTO ${T.companyRolePermissions} (role_id, permission_id)
         SELECT r, p FROM unnest(?::int[]) AS r, unnest(?::text[]) AS p`,
        [ids, permissions]
      );
    }
    return ids.length;
  });
}

// One-time: before copies were seeded for every company, a copy only existed because an admin
// had edited Member - so every copy present at that moment is the company's own version.
async function markExistingBuiltInCopiesModified(): Promise<number> {
  const result = await db.query(
    `UPDATE ${T.companyRoles} SET modified_at = updated_at, modified_by = created_by
      WHERE builtin_role IS NOT NULL AND modified_at IS NULL`
  );
  return result.rowCount || 0;
}

async function remove(id: number): Promise<boolean> {
  const result = await db.query(`DELETE FROM ${T.companyRoles} WHERE id = ?`, [id]);
  return result.rowCount! > 0;
}

// Retired permission ids leave company roles too (bootstrap's purge covers role_permissions).
async function purgePermissionsNotIn(permissionIds: readonly string[]): Promise<number> {
  const result = await db.query(
    `DELETE FROM ${T.companyRolePermissions} WHERE NOT (permission_id = ANY(?::text[]))`,
    [permissionIds]
  );
  return result.rowCount || 0;
}

async function grantReplacements(retired: string, replacements: readonly string[]): Promise<void> {
  await db.query(
    `INSERT INTO ${T.companyRolePermissions} (role_id, permission_id)
     SELECT p.role_id, r FROM ${T.companyRolePermissions} p, unnest(?::text[]) AS r
      WHERE p.permission_id = ?
     ON CONFLICT DO NOTHING`,
    [replacements, retired]
  );
}

export {
  listForCompany,
  builtInCounts,
  findInCompany,
  insert,
  update,
  remove,
  purgePermissionsNotIn,
  grantReplacements,
  findBuiltInOverride,
  seedBuiltInCopy,
  saveBuiltInCopy,
  resetBuiltInCopy,
  backfillBuiltInCopies,
  syncUnmodifiedBuiltInCopies,
  markExistingBuiltInCopiesModified,
};
