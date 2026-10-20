import crypto from 'node:crypto';
import config from '../../config';
import type { ContextProfile } from '../../generated/prisma/client';

const { prisma } = config.database;

interface ContextProfileRow {
  id: string;
  connection_id: string;
  name: string;
  description: string | null;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
}

function asRow(profile: ContextProfile): ContextProfileRow {
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

async function find(connectionId: string): Promise<ContextProfileRow | null> {
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
}): Promise<ContextProfileRow> {
  const profile = await prisma.contextProfile.upsert({
    where: { connectionId },
    create: { id: crypto.randomUUID(), connectionId, companyId, name, description, createdBy },
    update: { name, description, updatedAt: new Date() },
  });
  return asRow(profile);
}

export { find, upsert };
export type { ContextProfileRow };
