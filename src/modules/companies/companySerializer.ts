import { effectiveFeatures, featureKeysOf } from '../catalogue/catalogueService';

type Row = Record<string, any>;

function shapeCompany(row: Row | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: Boolean(row.active),
    createdAt: row.created_at || null,
    userCount: row.userCount === undefined ? undefined : Number(row.userCount),
    dashboardCount: row.dashboardCount === undefined ? undefined : Number(row.dashboardCount),
    pendingCount: row.pendingCount === undefined ? undefined : Number(row.pendingCount),
    features: row.feature_ids === undefined ? undefined : effectiveFeatures(featureKeysOf(row.feature_ids)),
  };
}

function companyOption(row: Row) {
  return { id: row.id, name: row.name, active: Boolean(row.active) };
}

export { shapeCompany, companyOption };
