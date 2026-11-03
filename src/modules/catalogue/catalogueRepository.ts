import config from '../../config';

const { prisma } = config.database;

async function loadAll() {
  const [permissions, features, accessLevels, systemRoles, connectors, auditEventTypes] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
    prisma.feature.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
    prisma.accessLevel.findMany({ orderBy: [{ resource: 'asc' }, { rank: 'asc' }] }),
    prisma.role.findMany({ where: { kind: 'system' }, orderBy: { name: 'asc' } }),
    prisma.connector.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    prisma.auditEventType.findMany({ orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] }),
  ]);
  return { permissions, features, accessLevels, systemRoles, connectors, auditEventTypes };
}

export { loadAll };
