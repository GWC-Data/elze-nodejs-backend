import config from '../config';
import { Prisma } from '../generated/prisma/client';
import { rawRows } from './baseRepository';

const { prisma, withTransaction } = config.database;

async function appliedMigrations(): Promise<string[]> {
  const [{ present }] = await rawRows(
    prisma,
    Prisma.sql`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`
  );
  if (!present) return [];
  const applied = await rawRows(
    prisma,
    Prisma.sql`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  );
  return applied.map((r) => r.migration_name);
}

async function countUsers(): Promise<number> {
  return prisma.user.count();
}

async function countUsersWithoutRole(): Promise<number> {
  return prisma.user.count({ where: { role: null } });
}

async function insertSuperAdmin({
  username,
  email,
  passwordHash,
  roleId,
}: {
  username: string;
  email: string;
  passwordHash: string;
  roleId: string;
}): Promise<void> {
  await withTransaction(async (tx) => {
    const user = await tx.user.create({
      data: { companyId: null, username, email, passwordHash, status: 'active', mustChangePassword: true },
      select: { id: true },
    });
    await tx.userRole.create({ data: { userId: user.id, roleId } });
  });
}

async function insertDashboardIfMissing({
  id,
  title,
  description,
  spec,
}: {
  id: string;
  title: string;
  description?: string | null;
  spec: unknown;
}): Promise<void> {
  await prisma.dashboard.createMany({
    data: [
      {
        id,
        title,
        description: description ?? null,
        companyId: null,
        createdBy: null,
        spec: spec as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
}

export { appliedMigrations, countUsers, countUsersWithoutRole, insertSuperAdmin, insertDashboardIfMissing };
