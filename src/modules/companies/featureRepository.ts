import config from '../../config';
import type { Tx } from '../../shared/db/database';

const { prisma } = config.database;

async function listForCompany(companyId: string, tx: Tx = prisma): Promise<string[]> {
  const row = await tx.companyFeatures.findUnique({ where: { companyId }, select: { featureIds: true } });
  return row ? row.featureIds : [];
}

async function replace(companyId: string, featureIds: readonly string[], actorId: string | null, tx: Tx = prisma) {
  await tx.companyFeatures.upsert({
    where: { companyId },
    create: { companyId, featureIds: [...featureIds], updatedBy: actorId },
    update: { featureIds: [...featureIds], updatedBy: actorId, updatedAt: new Date() },
  });
}

export { listForCompany, replace };
