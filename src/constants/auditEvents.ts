const EVENTS = {
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  LOGIN_BLOCKED: 'login_blocked',
  LOGOUT: 'logout',
  SESSION_REFRESHED: 'session_refreshed',
  SESSION_REVOKED: 'session_revoked',
  REFRESH_REUSE_DETECTED: 'refresh_reuse_detected',
  PASSWORD_CHANGED: 'password_changed',
  ACCOUNT_ACTIVATED: 'account_activated',

  COMPANY_CREATED: 'company_created',
  COMPANY_UPDATED: 'company_updated',
  COMPANY_DELETED: 'company_deleted',
  COMPANY_FEATURES_UPDATED: 'company_features_updated',

  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_ACTIVATED: 'user_activated',
  USER_DEACTIVATED: 'user_deactivated',
  USER_ACTIVATION_RESENT: 'user_activation_resent',
  USER_SCOPE_UPDATED: 'user_scope_updated',
  USER_PERMISSIONS_UPDATED: 'user_permissions_updated',

  ROLE_PERMISSIONS_UPDATED: 'role_permissions_updated',
  ROLE_CREATED: 'role_created',
  ROLE_UPDATED: 'role_updated',
  ROLE_DELETED: 'role_deleted',

  GROUP_CREATED: 'group_created',
  GROUP_UPDATED: 'group_updated',
  GROUP_DELETED: 'group_deleted',

  DASHBOARD_CREATED: 'dashboard_created',
  DASHBOARD_ASSIGNED: 'dashboard_assigned',
  DASHBOARD_UNASSIGNED: 'dashboard_unassigned',
  DASHBOARD_UPDATED: 'dashboard_updated',
  DASHBOARD_DELETED: 'dashboard_deleted',
  ACCESS_GRANTED: 'access_granted',
  ACCESS_REVOKED: 'access_revoked',
  ACCESS_DENIED: 'access_denied',

  CONTEXT_CONNECTION_CREATED: 'context_connection_created',
  CONTEXT_CONNECTION_DELETED: 'context_connection_deleted',
  CONTEXT_VERSION_CREATED: 'context_version_created',
  CONTEXT_PROFILE_SAVED: 'context_profile_saved',
  CONTEXT_FACT_UPDATED: 'context_fact_updated',
  CONTEXT_DATASETS_SELECTED: 'context_datasets_selected',
  CONTEXT_REVIEW_DECIDED: 'context_review_decided',
  CONTEXT_PUBLISHED: 'context_published',
  CONTEXT_VERSION_DELETED: 'context_version_deleted',
  CONTEXT_EXTRACTION_RUN: 'context_extraction_run',
  CONTEXT_ACCESS_GRANTED: 'context_access_granted',
  CONTEXT_ACCESS_UPDATED: 'context_access_updated',
  CONTEXT_ACCESS_REVOKED: 'context_access_revoked',
};

const FORBIDDEN_DETAIL_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'activationToken',
  'resetToken',
  'secret',
]);

const ENVELOPE_KEYS = new Set(['ts', 'event', 'actor', 'actorId', 'actorCompanyId']);

const SUMMARY_MAX = 240;

const AUDIT_SORTS: Record<string, string> = { ts: 'a.ts', event: 'a.event', actor: 'a.actor' };

export { EVENTS, FORBIDDEN_DETAIL_KEYS, ENVELOPE_KEYS, SUMMARY_MAX, AUDIT_SORTS };
