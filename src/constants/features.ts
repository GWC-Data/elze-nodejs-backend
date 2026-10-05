// The features a company can be given. The platform owner switches them on per company;
// a company's roles can only ever use the permissions of the features it has.
//
// A feature is a CEILING on permissions, not a grant: effective permissions are
//   (the account's role permissions) ∩ (permissions of the company's enabled features ∪ core)
// where "core" is every permission no feature owns (people, groups, audit, company settings).
// Nothing is deleted when a feature is switched off - its permissions are only masked, so
// switching it back on restores every role exactly as it was.
//
// `locked` features are on for every company and are never stored: Metadata Lakehouse is the
// foundation the other features read from, so no company can be without it, and no bad row
// in company_features can take it away.

interface Feature {
  id: string;
  label: string;
  description: string;
  locked: boolean;
  // The sidebar entries the feature covers - shown next to the toggle so the platform owner
  // knows what a switch actually does.
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
    permissions: ['context.read', 'context.create', 'context.update', 'context.publish', 'context.delete'],
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

// Stored rows → the full enabled set. Unknown ids (a feature since removed from this file)
// are dropped rather than trusted; locked features are always added.
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

// The features an account can actually use: enabled for its company AND holding at least one of
// their permissions. This - not the company's full list - is what goes to the browser, so a
// member's responses never name a feature their role gives them nothing in.
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
