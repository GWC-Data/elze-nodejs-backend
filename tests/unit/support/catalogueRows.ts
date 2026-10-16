import { EVENTS } from '../../../src/constants/auditEvents';
import { COMPANY_ADMIN, SUPER_ADMIN, USER } from '../../../src/constants/roles';

const FEATURE = {
  lakehouse: 'feature-lakehouse',
  agents: 'feature-agents',
  context: 'feature-context',
};

function auditCategory(event: string): string {
  if (event.startsWith('login') || event === 'logout') return 'auth';
  if (event.startsWith('company_')) return 'company';
  return 'other';
}

function auditAction(event: string): string | null {
  if (event.endsWith('_created')) return 'create';
  if (event.endsWith('_deleted')) return 'delete';
  return null;
}

function catalogueRows() {
  return {
    features: [
      {
        id: FEATURE.lakehouse,
        key: 'metadata_lakehouse',
        label: 'Lakehouse',
        description: null,
        locked: true,
        covers: ['dashboards'],
      },
      { id: FEATURE.agents, key: 'agents', label: 'Agents', description: 'AI agents', locked: false, covers: [] },
      {
        id: FEATURE.context,
        key: 'context_layer',
        label: 'Context layer',
        description: null,
        locked: false,
        covers: [],
      },
    ],
    permissions: [
      permission('perm-company-read', 'company.read', null),
      permission('perm-company-create', 'company.create', null, { platformOnly: true }),
      permission('perm-user-read', 'user.read', null),
      permission('perm-role-update', 'role.update', null, { adminOnly: true }),
      permission('perm-data-read', 'data.read', FEATURE.lakehouse),
      permission('perm-agent-run', 'agent.run', FEATURE.agents),
      permission('perm-context-read', 'context.read', FEATURE.context),
    ],
    accessLevels: [
      level('level-dash-view', 'dashboard', 'view', 1),
      level('level-dash-developer', 'dashboard', 'developer', 2),
      level('level-dash-admin', 'dashboard', 'admin', 3),
      level('level-context-read', 'context', 'read', 1),
      level('level-context-edit', 'context', 'edit', 2),
    ],
    systemRoles: [
      { id: 'role-super', tier: SUPER_ADMIN, name: 'Platform owner', description: null },
      { id: 'role-company-admin', tier: COMPANY_ADMIN, name: 'Company administrator', description: null },
      { id: 'role-user', tier: USER, name: 'User', description: 'Everyone else' },
    ],
    connectors: [
      {
        id: 'domo',
        name: 'Domo',
        status: 'available',
        description: 'Domo datasets',
        docsUrl: 'https://developer.domo.com',
        credentials: [{ id: 'token', label: 'Token', type: 'password', placeholder: '', help: '' }],
      },
      {
        id: 'snowflake',
        name: 'Snowflake',
        status: 'coming_soon',
        description: null,
        docsUrl: null,
        credentials: null,
      },
    ],
    auditEventTypes: Object.values(EVENTS).map((key) => ({
      key,
      label: `Label of ${key}`,
      categories: [auditCategory(key)],
      action: auditAction(key),
    })),
  };
}

function permission(
  id: string,
  key: string,
  featureId: string | null,
  flags: { platformOnly?: boolean; adminOnly?: boolean } = {}
) {
  return {
    id,
    key,
    label: key,
    description: null,
    featureId,
    platformOnly: Boolean(flags.platformOnly),
    adminOnly: Boolean(flags.adminOnly),
  };
}

function level(id: string, resource: string, key: string, rank: number) {
  return { id, resource, key, rank, label: key, description: null };
}

export { catalogueRows, FEATURE };
