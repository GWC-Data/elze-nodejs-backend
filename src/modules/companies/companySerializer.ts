import { effectiveFeatures, featureKeysOf, visibleFeatureKeys } from '../catalogue/catalogueService';
import type { CompanyOptionRow, CompanyRow } from './companyRepository';

type CompanySource = CompanyRow & {
  userCount?: number;
  dashboardCount?: number;
  pendingCount?: number;
  feature_ids?: string[];
  admin_id?: string | null;
  admin_username?: string | null;
  admin_display_name?: string | null;
  admin_email?: string | null;
};

function primaryAdminOf(row: CompanySource) {
  if (row.admin_id === undefined) return undefined;
  if (row.admin_id === null) return null;
  return {
    id: row.admin_id,
    username: row.admin_username as string,
    displayName: row.admin_display_name ?? null,
    email: row.admin_email as string,
  };
}

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
    primaryAdmin: primaryAdminOf(row),
  };
}

function companyOption(row: CompanyOptionRow) {
  return { id: row.id, name: row.name, active: Boolean(row.active) };
}

export { shapeCompany, companyOption };
export type { CompanySource };
