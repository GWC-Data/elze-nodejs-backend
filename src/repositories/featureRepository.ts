import config from '../config';
import type { Tx } from '../config/database';

const { prisma } = config.database;

async function listForCompany(companyId: number, tx: Tx = prisma): Promise<string[]> {
  const row = await tx.companyFeatures.findUnique({ where: { companyId }, select: { featureIds: true } });
  return row ? row.featureIds : [];
}

async function replace(companyId: number, featureIds: readonly string[], actorId: number | null, tx: Tx = prisma) {
  await tx.companyFeatures.upsert({
    where: { companyId },
    create: { companyId, featureIds: [...featureIds], updatedBy: actorId },
    update: { featureIds: [...featureIds], updatedBy: actorId, updatedAt: new Date() },
  });
}

export { listForCompany, replace };
