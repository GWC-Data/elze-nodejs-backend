const ROLE_SCOPES = { platform: 'platform', company: 'company' };

const ALL_PERMISSIONS = [
  { id: 'company.read', label: 'View Companies', description: 'See companies and their details.' },
  { id: 'company.create', label: 'Create Companies', description: 'Onboard a new customer company.' },
  { id: 'company.update', label: 'Update Companies', description: 'Rename a company, or activate and deactivate it.' },
  { id: 'company.delete', label: 'Delete Companies', description: 'Permanently remove a company and everything inside it.' },
  { id: 'company.features', label: 'Manage Company Features', description: 'Switch the features a company has on or off.' },

  { id: 'user.read', label: 'View Users', description: 'See the user directory and individual accounts.' },
  { id: 'user.create', label: 'Create Users', description: 'Onboard new accounts and send their activation email.' },
  { id: 'user.update', label: 'Update Users', description: 'Change an account’s role, and reissue its activation link.' },
  { id: 'user.delete', label: 'Delete Users', description: 'Permanently remove accounts.' },
  { id: 'user.activate', label: 'Activate Users', description: 'Re-enable a deactivated account.' },
  { id: 'user.deactivate', label: 'Deactivate Users', description: 'Disable an account and end its sessions.' },

  { id: 'role.read', label: 'View Roles', description: 'See the roles and the permissions each one holds.' },
  { id: 'role.update', label: 'Manage Role Permissions', description: 'Change which permissions a built-in role holds, for every company.' },
  { id: 'role.create', label: 'Create Company Roles', description: 'Create a custom role in your company.' },
  { id: 'role.edit', label: 'Edit Company Roles', description: 'Rename a custom role and change its permissions.' },
  { id: 'role.delete', label: 'Delete Company Roles', description: 'Delete a custom role no member holds.' },

  { id: 'group.read', label: 'View Groups', description: 'See groups and their membership.' },
  { id: 'group.create', label: 'Create Groups', description: 'Create groups within the company.' },
  { id: 'group.update', label: 'Update Groups', description: 'Rename groups and change their membership.' },
  { id: 'group.delete', label: 'Delete Groups', description: 'Delete groups and the access they carry.' },

  { id: 'access.read', label: 'View Access', description: 'See who has been granted which dashboard.' },
  { id: 'access.grant', label: 'Grant Access', description: 'Give a user or group access to a dashboard.' },
  { id: 'access.revoke', label: 'Revoke Access', description: 'Take dashboard access away from a user or group.' },

  { id: 'dashboard.read', label: 'Open Dashboards', description: 'Open a dashboard that has been granted to you.' },
  { id: 'dashboard.create', label: 'Create Dashboards', description: 'Create new dashboards.' },
  { id: 'dashboard.update', label: 'Edit Dashboards', description: 'Change the card configuration of a dashboard.' },
  { id: 'dashboard.delete', label: 'Delete Dashboards', description: 'Permanently remove a dashboard.' },
  { id: 'dashboard.assign', label: 'Assign Dashboards', description: 'Decide which dashboards a company may use.' },

  { id: 'data.read', label: 'Read Data', description: 'Read the source tables behind a granted dashboard.' },

  { id: 'context.read', label: 'View Metadata Lakehouse', description: 'See the connections, contexts and published versions of your company.' },
  { id: 'context.create', label: 'Create Contexts', description: 'Connect a data warehouse and start a new context or version.' },
  { id: 'context.update', label: 'Edit Contexts', description: 'Choose datasets, run the AI analysis, edit and review facts.' },
  { id: 'context.publish', label: 'Publish Contexts', description: 'Publish a draft as a new version that agents read.' },
  { id: 'context.delete', label: 'Delete Contexts', description: 'Delete a connection or a published version.' },

  { id: 'analyst.use', label: 'Use Data Analyst', description: 'Chat with the data analyst agent and manage your own chats.' },

  { id: 'playbook.read', label: 'View Playbooks', description: 'See playbooks, their runs and schedules.' },
  { id: 'playbook.create', label: 'Create Playbooks', description: 'Build playbooks with the Playbook Builder.' },
  { id: 'playbook.update', label: 'Edit Playbooks', description: 'Change an existing playbook.' },
  { id: 'playbook.delete', label: 'Delete Playbooks', description: 'Permanently remove a playbook.' },
  { id: 'playbook.run', label: 'Run Playbooks', description: 'Run a playbook and manage its schedules.' },

  { id: 'agent.read', label: 'View Agents', description: 'See the agents library and chat with an agent.' },
  { id: 'agent.create', label: 'Create Agents', description: 'Create a new agent on published contexts.' },
  { id: 'agent.update', label: 'Edit Agents', description: 'Change the agents you created.' },
  { id: 'agent.delete', label: 'Delete Agents', description: 'Delete the agents you created.' },
  { id: 'agent.schedule', label: 'Schedule Agents', description: 'Set or clear the schedule of the agents you created.' },
  { id: 'agent.manage_all', label: 'Manage Everyone’s Agents', description: 'Edit, delete and schedule agents other people created.' },

  { id: 'scope.read', label: 'View Data Scopes', description: 'See the row-level scopes assigned to a user.' },
  { id: 'scope.update', label: 'Update Data Scopes', description: 'Assign row-level data scopes to a user.' },
];

const PERMISSION_IDS = ALL_PERMISSIONS.map((p) => p.id);
const ALL_PERMISSION_IDS = new Set(PERMISSION_IDS);

const SUPER_ADMIN = 'SUPER_ADMIN';
const COMPANY_ADMIN = 'COMPANY_ADMIN';
const USER = 'USER';

const SYSTEM_ROLES = [
  {
    name: SUPER_ADMIN,
    scope: ROLE_SCOPES.platform,
    description: 'Platform owner. Manages every company, user, role and dashboard assignment.',
  },
  {
    name: COMPANY_ADMIN,
    scope: ROLE_SCOPES.company,
    description: 'Administrator of one company. Manages that company’s users, groups and access.',
  },
  {
    name: USER,
    scope: ROLE_SCOPES.company,
    description: 'Member of one company. Reaches only the resources explicitly granted to them.',
  },
];

const ROLE_NAMES = SYSTEM_ROLES.map((r) => r.name);
const ROLE_SCOPE_BY_NAME = new Map<string, string>(SYSTEM_ROLES.map((r) => [r.name, r.scope]));

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  [COMPANY_ADMIN]: [
    'company.read',
    'user.read', 'user.create', 'user.update', 'user.delete', 'user.activate', 'user.deactivate',
    'role.read', 'role.create', 'role.edit', 'role.delete',
    'group.read', 'group.create', 'group.update', 'group.delete',
    'access.read', 'access.grant', 'access.revoke',
    'dashboard.read', 'dashboard.create', 'dashboard.update', 'dashboard.delete',
    'data.read',
    'context.read', 'context.create', 'context.update', 'context.publish', 'context.delete',
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

// A custom company role is a member role: it can hold any feature permission and the read-only
// administration ones, but never the permissions that manage people, groups or roles. Those
// stay with COMPANY_ADMIN, because assertCanManageUser only lets a company admin manage members
// - a custom role holding them would show buttons that every request then refuses.
const CUSTOM_ROLE_EXCLUDED = new Set([
  'user.create', 'user.update', 'user.delete', 'user.activate', 'user.deactivate',
  'group.create', 'group.update', 'group.delete',
  'role.create', 'role.edit', 'role.delete',
  'scope.update',
]);

// Permissions retired from the catalogue, and what a role that held one gets instead - so a
// split never silently takes access away. Applied once at startup, before the purge.
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
  ALL_PERMISSION_IDS,
  PERMISSION_IDS,
  PLATFORM_ONLY_PERMISSIONS,
  SUPER_ADMIN,
  COMPANY_ADMIN,
  USER,
  SYSTEM_ROLES,
  ROLE_NAMES,
  ROLE_SCOPE_BY_NAME,
  DEFAULT_ROLE_PERMISSIONS,
  CUSTOM_ROLE_EXCLUDED,
  REPLACED_PERMISSIONS,
  LEVEL_RANK,
  ACCESS_LEVELS,
  ACCESS_LEVEL_LABELS,
};
