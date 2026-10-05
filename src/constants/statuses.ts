const USER_STATUS = { ACTIVE: 'active', PENDING: 'pending', DISABLED: 'disabled' };

const AUTH_STATE = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  AUTHENTICATED: 'AUTHENTICATED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
};

const CONNECTION_STATUS = { CONNECTED: 'connected', INVALID: 'invalid' };

const REVIEW_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', SKIPPED: 'skipped' };

const REVIEW_DECISION_STATUS: Record<string, string> = { approve: 'approved', reject: 'rejected', skip: 'skipped' };

const VERSION_STATUS = { DRAFT: 'draft', PUBLISHED: 'published' };

const CONTEXT_STEPS = ['connect', 'context', 'discover', 'profile', 'understand', 'model', 'review', 'publish'];

const USER_STATUSES = Object.values(USER_STATUS);
const REVIEW_DECISIONS = new Set(Object.keys(REVIEW_DECISION_STATUS));

export {
  USER_STATUS,
  USER_STATUSES,
  AUTH_STATE,
  CONNECTION_STATUS,
  REVIEW_STATUS,
  REVIEW_DECISION_STATUS,
  REVIEW_DECISIONS,
  VERSION_STATUS,
  CONTEXT_STEPS,
};
