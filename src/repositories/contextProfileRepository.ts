import crypto from 'node:crypto';
import config from '../config';

const { prisma } = config.database;

function asRow(profile: {
  id: string;
  connectionId: string;
  name: string;
  description: string | null;
  createdBy: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: profile.id,
    connection_id: profile.connectionId,
    name: profile.name,
    description: profile.description,
    created_by: profile.createdBy,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
  };
}

async function find(connectionId: string) {
  const profile = await prisma.contextProfile.findUnique({ where: { connectionId } });
  return profile ? asRow(profile) : null;
}

async function upsert({
  connectionId,
  companyId,
  name,
  description,
  createdBy,
}: {
  connectionId: string;
  companyId: number;
  name: string;
  description: string | null;
  createdBy: number | null;
}) {
  const profile = await prisma.contextProfile.upsert({
    where: { connectionId },
    create: { id: crypto.randomUUID(), connectionId, companyId, name, description, createdBy },
    update: { name, description, updatedAt: new Date() },
  });
  return asRow(profile);
}

export { find, upsert };
