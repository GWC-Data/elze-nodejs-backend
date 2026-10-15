import { quoteIdentifier, quoteQualified } from '../tools/sql';

const q = quoteIdentifier;

const ACCESS_SCHEMA = 'access_control';

const a = (name: string) => quoteQualified(ACCESS_SCHEMA, name);

const T = {
  companies: q('companies'),
  users: q('users'),
  groups: q('groups'),
  groupUsers: q('group_users'),
  dashboards: q('dashboards'),
  refreshTokens: q('refresh_tokens'),
  userTokens: q('user_tokens'),
  loginAttempts: q('login_attempts'),
  rbacRepairs: q('rbac_repairs'),
  auditLogs: q('audit_logs'),

  features: a('features'),
  permissions: a('permissions'),
  accessLevels: a('access_levels'),
  roles: a('roles'),
  rolePermissions: a('role_permissions'),
  companyFeatures: a('company_features'),
  userRoles: a('user_roles'),
  userPermissions: a('user_permissions'),
  userDataScopes: a('user_data_scopes'),
  companyDashboards: a('company_dashboards'),
  dashboardUserAccess: a('dashboard_user_access'),
  dashboardGroupAccess: a('dashboard_group_access'),
  contextUserAccess: a('context_user_access'),
  contextGroupAccess: a('context_group_access'),
};

const V = {
  userEffectivePermissions: a('user_effective_permissions'),
  userResourceAccess: a('user_resource_access'),
  userAccessSummary: a('user_access_summary'),
  rolePermissionSummary: a('role_permission_summary'),
  companyFeatureSummary: a('company_feature_summary'),
};

export { ACCESS_SCHEMA, T, V };
