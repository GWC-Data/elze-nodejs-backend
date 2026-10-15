import config from '../config';
import { T } from '../models/rbacModel';
import type { Queryable } from '../config/pgPool';

const { db } = config.database;

async function appliedMigrations(): Promise<string[]> {
  const { rows } = await db.query(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`);
  if (!rows[0].present) return [];
  const applied = await db.query(
    `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  );
  return applied.rows.map((r) => r.migration_name);
}

async function countUsers(): Promise<number> {
  const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.users}`);
  return rows[0].n;
}

async function countUsersWithoutRole(): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${T.users} u
      WHERE NOT EXISTS (SELECT 1 FROM ${T.userRoles} ur WHERE ur.user_id = u.id)`
  );
  return rows[0].n;
}

async function insertSuperAdmin({ username, email, passwordHash, roleId }: {
  username: string;
  email: string;
  passwordHash: string;
  roleId: string;
}): Promise<void> {
  await db.transaction(async (conn: Queryable) => {
    const { rows } = await conn.query(
      `INSERT INTO ${T.users} (company_id, username, email, password_hash, status, must_change_password)
       VALUES (NULL, ?, ?, ?, 'active', TRUE) RETURNING id`,
      [username, email, passwordHash]
    );
    await conn.query(`INSERT INTO ${T.userRoles} (user_id, role_id) VALUES (?, ?)`, [rows[0].id, roleId]);
  });
}

async function insertDashboardIfMissing({ id, title, description, spec }: {
  id: string;
  title: string;
  description?: string | null;
  spec: unknown;
}): Promise<void> {
  await db.query(
    `INSERT INTO ${T.dashboards} (id, title, description, company_id, created_by, spec)
     VALUES (?, ?, ?, NULL, NULL, ?)
     ON CONFLICT (id) DO NOTHING`,
    [id, title, description, JSON.stringify(spec)]
  );
}

export {
  appliedMigrations,
  countUsers,
  countUsersWithoutRole,
  insertSuperAdmin,
  insertDashboardIfMissing,
};
