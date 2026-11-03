import config from '../../config';
import type { Prisma } from '../../generated/prisma/client';
import type { VersionStatus } from '../../generated/prisma/enums';
import { NOT_DELETED } from '../../shared/db/softDelete';

const { prisma } = config.database;

interface BusinessLayerRow {
  version_id: string;
  status: VersionStatus;
  business_layer: Prisma.JsonValue;
  business_layer_updated_at: Date | null;
}

const FIELDS = {
  id: true,
  status: true,
  businessLayer: true,
  businessLayerUpdatedAt: true,
} satisfies Prisma.ContextLayerVersionSelect;

type Fields = Prisma.ContextLayerVersionGetPayload<{ select: typeof FIELDS }>;

function asRow(version: Fields | null): BusinessLayerRow | null {
  if (!version) return null;
  return {
    version_id: version.id,
    status: version.status,
    business_layer: version.businessLayer,
    business_layer_updated_at: version.businessLayerUpdatedAt,
  };
}

async function forPublished(connectionId: string, versionId: string): Promise<BusinessLayerRow | null> {
  return asRow(
    await prisma.contextLayerVersion.findFirst({
      where: { id: versionId, connectionId, status: 'published', ...NOT_DELETED },
      select: FIELDS,
    })
  );
}

async function latest(connectionId: string): Promise<BusinessLayerRow | null> {
  const draft = await prisma.contextLayerVersion.findFirst({
    where: { connectionId, status: 'draft' },
    select: FIELDS,
  });
  if (draft) return asRow(draft);
  return asRow(
    await prisma.contextLayerVersion.findFirst({
      where: { connectionId, status: 'published', ...NOT_DELETED },
      orderBy: { publishedAt: 'desc' },
      select: FIELDS,
    })
  );
}

async function companyName(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  return company?.name ?? null;
}

export { forPublished, latest, companyName };
export type { BusinessLayerRow };
