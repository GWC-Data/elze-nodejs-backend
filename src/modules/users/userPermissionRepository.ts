import config from '../../config';

const { prisma } = config.database;

async function permissionIds(userId: string): Promise<string[]> {
  const row = await prisma.userPermissions.findUnique({ where: { userId }, select: { permissionIds: true } });
  return row ? row.permissionIds : [];
}

async function replace(userId: string, ids: readonly string[], actorId: string | null): Promise<void> {
  if (!ids.length) {
    await prisma.userPermissions.deleteMany({ where: { userId } });
    return;
  }
  await prisma.userPermissions.upsert({
    where: { userId },
    create: { userId, permissionIds: [...ids], updatedBy: actorId },
    update: { permissionIds: [...ids], updatedBy: actorId, updatedAt: new Date() },
  });
}

export { permissionIds, replace };
