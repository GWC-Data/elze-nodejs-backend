const ROLE_SCOPES = { platform: 'platform', company: 'company' };

const ALL_PERMISSIONS = [
  { id: '25b11a0f-e42e-4e4d-aebf-06abb0ecf4c1', key: 'company.read', label: 'View Companies', description: 'See companies and their details.' },
  { id: 'aabdaaf6-f03a-4d7c-96d9-1f6d3b069f13', key: 'company.create', label: 'Create Companies', description: 'Onboard a new customer company.' },
  { id: 'ea9d9b78-9ca4-4eb9-8e7b-04fb780f05dd', key: 'company.update', label: 'Update Companies', description: 'Rename a company, or activate and deactivate it.' },
  { id: '409c9b3d-a84c-440d-a7c5-994dbc9a6acb', key: 'company.delete', label: 'Delete Companies', description: 'Permanently remove a company and everything inside it.' },
  { id: '3a261a33-e359-47bd-acaa-65afddeae671', key: 'company.features', label: 'Manage Company Features', description: 'Switch the features a company has on or off.' },

  { id: 'bbfea992-e3ee-42a9-a479-f0a828c182d4', key: 'user.read', label: 'View Users', description: 'See the user directory and individual accounts.' },
  { id: '81c2a6a0-eb5c-41ba-83d4-53802c18d8af', key: 'user.create', label: 'Create Users', description: 'Onboard new accounts and send their activation email.' },
  { id: 'edfd461e-eac9-4067-931e-a7dc7c22deaa', key: 'user.update', label: 'Update Users', description: 'Change an account’s role, and reissue its activation link.' },
  { id: '674255bc-8a99-4b01-a143-df7ace6a65e6', key: 'user.delete', label: 'Delete Users', description: 'Permanently remove accounts.' },
  { id: '08e2331b-d946-4936-b254-44c61d399f9c', key: 'user.activate', label: 'Activate Users', description: 'Re-enable a deactivated account.' },
  { id: '699bfe3a-76bc-420b-a600-d9863dcab485', key: 'user.deactivate', label: 'Deactivate Users', description: 'Disable an account and end its sessions.' },

  { id: '8c379452-4769-4c84-a4be-12632b1e35d1', key: 'role.read', label: 'View Roles', description: 'See the roles and the permissions each one holds.' },
  { id: '1efce2a2-0576-443c-8f6a-5b6db4ef8c31', key: 'role.update', label: 'Manage Role Permissions', description: 'Change which permissions a built-in role holds, for every company.' },
  { id: '6cf252de-9c65-4ecb-a044-2603cb57d0c4', key: 'role.create', label: 'Create Company Roles', description: 'Create a custom role in your company.' },
  { id: 'de4cca58-2f64-4dbb-b97b-f3c00f20491d', key: 'role.edit', label: 'Edit Company Roles', description: 'Rename a custom role and change its permissions.' },
  { id: '9876ed7d-4763-4b87-b9f9-8f2fa4c3c961', key: 'role.delete', label: 'Delete Company Roles', description: 'Delete a custom role no member holds.' },

  { id: '59d59584-88f0-4dce-a964-842d86442060', key: 'group.read', label: 'View Groups', description: 'See groups and their membership.' },
  { id: 'f10b1f92-5763-4240-bd60-1802babe0527', key: 'group.create', label: 'Create Groups', description: 'Create groups within the company.' },
  { id: 'f31de92f-9642-45bb-8e94-f76ee6b20e02', key: 'group.update', label: 'Update Groups', description: 'Rename groups and change their membership.' },
  { id: 'f2917a3f-9b07-4d0b-b6ad-3f4f364a6066', key: 'group.delete', label: 'Delete Groups', description: 'Delete groups and the access they carry.' },

  { id: '77dfe7d4-1115-41a5-a16d-97069c98c48c', key: 'access.read', label: 'View Access', description: 'See who has been granted which dashboard.' },
  { id: 'ee9b1bd0-f175-40f6-8b65-482b362f5893', key: 'access.grant', label: 'Grant Access', description: 'Give a user or group access to a dashboard.' },
  { id: '2a8414a4-e6d3-42a0-8e95-a6c2eeceea7e', key: 'access.revoke', label: 'Revoke Access', description: 'Take dashboard access away from a user or group.' },

  { id: '1e61c36d-a147-4c52-86c6-1efcad204558', key: 'dashboard.read', label: 'Open Dashboards', description: 'Open a dashboard that has been granted to you.' },
  { id: 'f5c12def-b22b-4d63-b925-1865d353b7ce', key: 'dashboard.create', label: 'Create Dashboards', description: 'Create new dashboards.' },
  { id: '72eafd38-3ce0-4c7a-9838-131ae77cc35a', key: 'dashboard.update', label: 'Edit Dashboards', description: 'Change the card configuration of a dashboard.' },
  { id: 'd8d7acf0-d7a0-45d5-834d-79bad948ff92', key: 'dashboard.delete', label: 'Delete Dashboards', description: 'Permanently remove a dashboard.' },
  { id: '5d52979f-2d66-4015-a3f7-dd766def2abb', key: 'dashboard.assign', label: 'Assign Dashboards', description: 'Decide which dashboards a company may use.' },

  { id: 'ea4285b7-3a39-4b08-9b96-4d89cb2697f7', key: 'data.read', label: 'Read Data', description: 'Read the source tables behind a granted dashboard.' },

  { id: '347eb6ed-ea14-4c2b-a215-1d60dc52eaa0', key: 'context.read', label: 'View Metadata Lakehouse', description: 'See the connections, contexts and published versions of your company.' },
  { id: 'dfbe89db-114d-4c38-9934-c12715407ceb', key: 'context.create', label: 'Create Contexts', description: 'Connect a data warehouse and start a new context or version.' },
  { id: 'a31ef6fb-b600-4d10-bddc-aa8a90600ee4', key: 'context.update', label: 'Edit Contexts', description: 'Choose datasets, run the AI analysis, edit and review facts.' },
  { id: '4f8a83ea-1d6e-41d9-a453-9907ea285121', key: 'context.publish', label: 'Publish Contexts', description: 'Publish a draft as a new version that agents read.' },
  { id: 'dd73ca5f-92e3-480a-8cb5-7024229ec780', key: 'context.delete', label: 'Delete Contexts', description: 'Delete a connection or a published version.' },
  { id: 'c83b79fd-2d9f-46ae-b12b-bc486a4b61aa', key: 'context.manage_all', label: 'Manage Every Context', description: 'Open, edit and delete every context of your company, not only your own and the ones shared with you.' },

  { id: 'b1b68eaa-e599-4488-bd79-c17f02299321', key: 'analyst.use', label: 'Use Data Analyst', description: 'Chat with the data analyst agent and manage your own chats.' },

  { id: '65e7d4f9-f9c5-46c4-a246-0c29ed378268', key: 'playbook.read', label: 'View Playbooks', description: 'See playbooks, their runs and schedules.' },
  { id: 'dea45e30-f930-477d-ab6f-93ca73ac6bbf', key: 'playbook.create', label: 'Create Playbooks', description: 'Build playbooks with the Playbook Builder.' },
  { id: '842fd937-93c2-4789-9928-7f2cd8a74565', key: 'playbook.update', label: 'Edit Playbooks', description: 'Change an existing playbook.' },
  { id: 'b1e815b5-561c-42b2-a9bc-6f58d5da64b9', key: 'playbook.delete', label: 'Delete Playbooks', description: 'Permanently remove a playbook.' },
  { id: '9f5246e9-bb69-4ad0-b7f5-c955a7f6827d', key: 'playbook.run', label: 'Run Playbooks', description: 'Run a playbook and manage its schedules.' },

  { id: '2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8', key: 'agent.read', label: 'View Agents', description: 'See the agents library and chat with an agent.' },
  { id: 'b659cb7f-562c-4487-8fde-b51e5d269a91', key: 'agent.create', label: 'Create Agents', description: 'Create a new agent on published contexts.' },
  { id: '1e1e2e84-555d-477d-9bb9-86950d979681', key: 'agent.update', label: 'Edit Agents', description: 'Change the agents you created.' },
  { id: '1a15c2b1-f63f-4013-9588-f8141649fdeb', key: 'agent.delete', label: 'Delete Agents', description: 'Delete the agents you created.' },
  { id: '314cd364-c82a-40dc-8c3d-d12257181285', key: 'agent.schedule', label: 'Schedule Agents', description: 'Set or clear the schedule of the agents you created.' },
  { id: '232b52e5-81b8-4d37-86d6-f96e4361f4cf', key: 'agent.manage_all', label: 'Manage Everyone’s Agents', description: 'Edit, delete and schedule agents other people created.' },

  { id: '2e3129c4-6a5c-4abd-9629-84d09819beaf', key: 'scope.read', label: 'View Data Scopes', description: 'See the row-level scopes assigned to a user.' },
  { id: 'b0171ac6-9d88-4c95-bb29-bb88a288baad', key: 'scope.update', label: 'Update Data Scopes', description: 'Assign row-level data scopes to a user.' },
];

const PERMISSION_KEYS = ALL_PERMISSIONS.map((p) => p.key);
const ALL_PERMISSION_KEYS = new Set(PERMISSION_KEYS);
const PERMISSION_BY_ID = new Map(ALL_PERMISSIONS.map((p) => [p.id, p]));
const PERMISSION_BY_KEY = new Map(ALL_PERMISSIONS.map((p) => [p.key, p]));

function permissionIdOf(key: string): string {
  const permission = PERMISSION_BY_KEY.get(key);
  if (!permission) throw new Error(`Unknown permission "${key}".`);
  return permission.id;
}

function permissionIdsOf(keys: readonly string[]): string[] {
  return keys.filter((key) => PERMISSION_BY_KEY.has(key)).map(permissionIdOf);
}

function permissionKeysOf(ids: readonly string[] | null | undefined): string[] {
  return (ids || []).map((id) => PERMISSION_BY_ID.get(String(id))?.key).filter((key): key is string => Boolean(key));
}

const SUPER_ADMIN = 'SUPER_ADMIN';
const COMPANY_ADMIN = 'COMPANY_ADMIN';
const USER = 'USER';

const SYSTEM_ROLES = [
  {
    id: 'b81ad886-d47f-4978-8bfd-e8c28d745c81',
    name: SUPER_ADMIN,
    label: 'Platform owner',
    scope: ROLE_SCOPES.platform,
    description: 'Platform owner. Manages every company, user, role and dashboard assignment.',
  },
  {
    id: '301f455d-b2f0-4a7c-82db-66ed9fe2fd9d',
    name: COMPANY_ADMIN,
    label: 'Company admin',
    scope: ROLE_SCOPES.company,
    description: 'Administrator of one company. Manages that company’s users, groups and access.',
  },
  {
    id: '3f1c0146-ec04-43b6-85ba-6b27f7f60a28',
    name: USER,
    label: 'Member',
    scope: ROLE_SCOPES.company,
    description: 'Member of one company. Reaches only the resources explicitly granted to them.',
  },
];

const ROLE_NAMES = SYSTEM_ROLES.map((r) => r.name);
const ROLE_SCOPE_BY_NAME = new Map<string, string>(SYSTEM_ROLES.map((r) => [r.name, r.scope]));
const SYSTEM_ROLE_ID: Record<string, string> = Object.fromEntries(SYSTEM_ROLES.map((r) => [r.name, r.id]));
const SYSTEM_ROLE_BY_ID = new Map(SYSTEM_ROLES.map((r) => [r.id, r]));

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  [COMPANY_ADMIN]: [
    'company.read',
    'user.read', 'user.create', 'user.update', 'user.delete', 'user.activate', 'user.deactivate',
    'role.read', 'role.create', 'role.edit', 'role.delete',
    'group.read', 'group.create', 'group.update', 'group.delete',
    'access.read', 'access.grant', 'access.revoke',
    'dashboard.read', 'dashboard.create', 'dashboard.update', 'dashboard.delete',
    'data.read',
    'context.read', 'context.create', 'context.update', 'context.publish', 'context.delete', 'context.manage_all',
    'analyst.use',
    'playbook.read', 'playbook.create', 'playbook.update', 'playbook.delete', 'playbook.run',
    'agent.read', 'agent.create', 'agent.update', 'agent.delete', 'agent.schedule', 'agent.manage_all',
    'scope.read', 'scope.update',
  ],
  [USER]: [
    'dashboard.read', 'dashboard.create', 'dashboard.update', 'data.read',
    'context.read',
    'analyst.use',
    'playbook.read', 'playbook.create', 'playbook.update', 'playbook.run',
    'agent.read', 'agent.create', 'agent.update', 'agent.schedule',
  ],
};

const CUSTOM_ROLE_EXCLUDED = new Set([
  'user.create', 'user.update', 'user.delete', 'user.activate', 'user.deactivate',
  'group.create', 'group.update', 'group.delete',
  'role.create', 'role.edit', 'role.delete',
  'scope.update',
]);

const REPLACED_PERMISSIONS: Record<string, string[]> = {
  'context.manage': ['context.create', 'context.update', 'context.publish', 'context.delete'],
};

const PLATFORM_ONLY_PERMISSIONS = new Set([
  'company.create',
  'company.update',
  'company.delete',
  'company.features',
  'role.update',
  'dashboard.assign',
]);

const LEVEL_RANK: Record<string, number> = { view: 1, share: 2, developer: 3, admin: 4 };
const ACCESS_LEVELS = Object.keys(LEVEL_RANK);

const ACCESS_LEVEL_LABELS: Record<string, string> = {
  view: 'Open the dashboard and use its slicers.',
  share: 'View, plus grant other users in the company access to it.',
  developer: 'Share, plus change the dashboard card configuration.',
  admin: 'Developer, plus full control of the dashboard and its grants.',
};

export {
  ROLE_SCOPES,
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PERMISSION_KEYS,
  PERMISSION_BY_ID,
  PERMISSION_BY_KEY,
  permissionIdOf,
  permissionIdsOf,
  permissionKeysOf,
  PLATFORM_ONLY_PERMISSIONS,
  SUPER_ADMIN,
  COMPANY_ADMIN,
  USER,
  SYSTEM_ROLES,
  SYSTEM_ROLE_ID,
  SYSTEM_ROLE_BY_ID,
  ROLE_NAMES,
  ROLE_SCOPE_BY_NAME,
  DEFAULT_ROLE_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
  REPLACED_PERMISSIONS,
  LEVEL_RANK,
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
};
