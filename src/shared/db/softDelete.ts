import { Prisma } from '../../generated/prisma/client';

const NOT_DELETED = { deletedAt: null } as const;

function notDeleted(alias: string): Prisma.Sql {
  return Prisma.raw(`${alias}.deleted_at IS NULL`);
}

function notDeletedRef(table: string, idColumn: string): Prisma.Sql {
  return Prisma.raw(
    `NOT EXISTS (SELECT 1 FROM ${table} gone WHERE gone.id = ${idColumn} AND gone.deleted_at IS NOT NULL)`
  );
}

function softDeletion(actorId: number | null | undefined): { deletedAt: Date; deletedBy: number | null } {
  return { deletedAt: new Date(), deletedBy: actorId ?? null };
}

export { NOT_DELETED, notDeleted, notDeletedRef, softDeletion };
