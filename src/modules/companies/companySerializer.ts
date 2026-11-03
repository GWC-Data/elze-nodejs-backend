import { effectiveFeatures, featureKeysOf, visibleFeatureKeys } from '../catalogue/catalogueService';
import type { CompanyOptionRow, CompanyRow } from './companyRepository';

type CompanySource = CompanyRow & {
  userCount?: number;
  dashboardCount?: number;
  pendingCount?: number;
  feature_ids?: string[];
};

function shapeCompany(row: CompanySource | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    active: Boolean(row.active),
    createdAt: row.created_at || null,
    userCount: row.userCount === undefined ? undefined : Number(row.userCount),
    pendingCount: row.pendingCount === undefined ? undefined : Number(row.pendingCount),
    features:
      row.feature_ids === undefined ? undefined : visibleFeatureKeys(effectiveFeatures(featureKeysOf(row.feature_ids))),
  };
}

function companyOption(row: CompanyOptionRow) {
  return { id: row.id, name: row.name, active: Boolean(row.active) };
}

export { shapeCompany, companyOption };
export type { CompanySource };
