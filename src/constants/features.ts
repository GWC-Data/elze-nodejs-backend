interface Feature {
  id: string;
  key: string;
  label: string;
  description: string;
  locked: boolean;
  covers: string[];
  permissions: string[];
}

const FEATURES: Feature[] = [
  {
    id: 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1',
    key: 'metadata_lakehouse',
    label: 'Metadata Lakehouse',
    description: 'Connect a warehouse, build and publish the business context every agent reads.',
    locked: true,
    covers: ['Metadata Lakehouse'],
    permissions: ['context.read', 'context.create', 'context.update', 'context.publish', 'context.delete', 'context.manage_all'],
  },
  {
    id: 'f9dbb017-fd03-4543-be26-1532bd30fab4',
    key: 'data_analyst',
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
    id: '92353e69-80c5-4629-96ef-a334ce371e81',
    key: 'agents',
    label: 'Agents',
    description: 'Build custom agents on published contexts, chat with them and schedule them.',
    locked: false,
    covers: ['Agents'],
    permissions: [
      'agent.read', 'agent.create', 'agent.update', 'agent.delete', 'agent.schedule', 'agent.manage_all',
    ],
  },
  {
    id: '94f51f0f-2951-4381-9e80-33c82bd8dc11',
    key: 'dashboards',
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

const FEATURE_KEYS = FEATURES.map((f) => f.key);
const LOCKED_FEATURE_KEYS = FEATURES.filter((f) => f.locked).map((f) => f.key);
const TOGGLEABLE_FEATURE_KEYS = FEATURES.filter((f) => !f.locked).map((f) => f.key);
const FEATURE_BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
const FEATURE_BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

const FEATURE_OF_PERMISSION = new Map<string, string>();
for (const feature of FEATURES) {
  for (const permission of feature.permissions) {
    if (FEATURE_OF_PERMISSION.has(permission)) {
      throw new Error(`Permission "${permission}" is claimed by two features.`);
    }
    FEATURE_OF_PERMISSION.set(permission, feature.key);
  }
}

function featureIdsOf(keys: readonly string[]): string[] {
  return keys.map((key) => FEATURE_BY_KEY.get(key)?.id).filter((id): id is string => Boolean(id));
}

function featureKeysOf(ids: readonly string[] | null | undefined): string[] {
  return (ids || []).map((id) => FEATURE_BY_ID.get(String(id))?.key).filter((key): key is string => Boolean(key));
}

function effectiveFeatures(stored: readonly string[] | null | undefined): string[] {
  const enabled = new Set(LOCKED_FEATURE_KEYS);
  for (const key of stored || []) if (FEATURE_BY_KEY.has(key)) enabled.add(key);
  return FEATURE_KEYS.filter((key) => enabled.has(key));
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
    FEATURE_BY_KEY.get(feature)!.permissions.some((p) => permissions.includes(p))
  );
}

export {
  FEATURES,
  FEATURE_KEYS,
  LOCKED_FEATURE_KEYS,
  TOGGLEABLE_FEATURE_KEYS,
  FEATURE_BY_KEY,
  FEATURE_BY_ID,
  FEATURE_OF_PERMISSION,
  featureIdsOf,
  featureKeysOf,
  effectiveFeatures,
  isPermissionEnabled,
  maskPermissions,
  usableFeatures,
};
export type { Feature };
