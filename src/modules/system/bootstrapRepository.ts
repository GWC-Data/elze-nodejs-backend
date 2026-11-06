import config from '../../config';
import { Prisma } from '../../generated/prisma/client';
import { rawRows } from '../../shared/db/baseRepository';

const { prisma } = config.database;

async function appliedMigrations(): Promise<string[]> {
  const [{ present }] = await rawRows<{ present: boolean }>(
    prisma,
    Prisma.sql`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`
  );
  if (!present) return [];
  const applied = await rawRows<{ migration_name: string }>(
    prisma,
    Prisma.sql`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  );
  return applied.map((r) => r.migration_name);
}

async function countUsersWithoutRole(): Promise<number> {
  return prisma.user.count({ where: { role: null } });
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

export { appliedMigrations, countUsersWithoutRole, insertDashboardIfMissing };
