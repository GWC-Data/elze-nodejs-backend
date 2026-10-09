interface Feature {
  id: string;
  label: string;
  description: string;
  locked: boolean;
  covers: string[];
  permissions: string[];
}

const FEATURES: Feature[] = [
  {
    id: 'metadata_lakehouse',
    label: 'Metadata Lakehouse',
    description: 'Connect a warehouse, build and publish the business context every agent reads.',
    locked: true,
    covers: ['Metadata Lakehouse'],
    permissions: ['context.read', 'context.create', 'context.update', 'context.publish', 'context.delete', 'context.manage_all'],
  },
  {
    id: 'data_analyst',
    label: 'Data analyst agent',
    description: 'Chat with the data analyst, and build, run and schedule playbooks.',
    locked: false,
    covers: ['Data analyst', 'Playbooks'],
    permissions: [
      'analyst.use',
      'playbook.read', 'playbook.create', 'playbook.update', 'playbook.delete', 'playbook.run',
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    description: 'Build custom agents on published contexts, chat with them and schedule them.',
    locked: false,
    covers: ['Agents'],
    permissions: [
      'agent.read', 'agent.create', 'agent.update', 'agent.delete', 'agent.schedule', 'agent.manage_all',
    ],
  },
  {
    id: 'dashboards',
    label: 'Dashboards',
    description: 'BI dashboards, their sharing and data scopes, and the data sources behind them.',
    locked: false,
    covers: ['Dashboards', 'Data sources', 'Dashboard access'],
    permissions: [
      'dashboard.read', 'dashboard.create', 'dashboard.update', 'dashboard.delete',
      'data.read',
      'access.read', 'access.grant', 'access.revoke',
      'scope.read', 'scope.update',
    ],
  },
];

const FEATURE_IDS = FEATURES.map((f) => f.id);
const LOCKED_FEATURE_IDS = FEATURES.filter((f) => f.locked).map((f) => f.id);
const TOGGLEABLE_FEATURE_IDS = FEATURES.filter((f) => !f.locked).map((f) => f.id);
const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

const FEATURE_OF_PERMISSION = new Map<string, string>();
for (const feature of FEATURES) {
  for (const permission of feature.permissions) {
    if (FEATURE_OF_PERMISSION.has(permission)) {
      throw new Error(`Permission "${permission}" is claimed by two features.`);
    }
    FEATURE_OF_PERMISSION.set(permission, feature.id);
  }
}

function effectiveFeatures(stored: readonly string[] | null | undefined): string[] {
  const enabled = new Set(LOCKED_FEATURE_IDS);
  for (const id of stored || []) if (FEATURE_BY_ID.has(id)) enabled.add(id);
  return FEATURE_IDS.filter((id) => enabled.has(id));
}

function isPermissionEnabled(permission: string, features: readonly string[]): boolean {
  const feature = FEATURE_OF_PERMISSION.get(permission);
  return !feature || features.includes(feature);
}

function maskPermissions(permissions: readonly string[], features: readonly string[]): string[] {
  return permissions.filter((p) => isPermissionEnabled(p, features));
}

function usableFeatures(features: readonly string[], permissions: readonly string[]): string[] {
  return features.filter((feature) =>
    FEATURE_BY_ID.get(feature)!.permissions.some((p) => permissions.includes(p))
  );
}

export {
  FEATURES,
  FEATURE_IDS,
  LOCKED_FEATURE_IDS,
  TOGGLEABLE_FEATURE_IDS,
  FEATURE_BY_ID,
  FEATURE_OF_PERMISSION,
  effectiveFeatures,
  isPermissionEnabled,
  maskPermissions,
  usableFeatures,
};
export type { Feature };
