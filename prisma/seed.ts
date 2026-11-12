import config from '../src/config';
import type { Prisma } from '../src/generated/prisma/client';
import type { AccessResource, AuditAction, ConnectorStatus, RoleTier } from '../src/generated/prisma/enums';
import type { Tx } from '../src/shared/db/database';
import { hashPassword } from '../src/shared/security/password';

const { prisma, withTransaction } = config.database;
const { bootstrapSuperAdmin } = config.auth;

interface FeatureSeed {
  id: string;
  key: string;
  label: string;
  description: string | null;
  locked: boolean;
  hidden: boolean;
  covers: string[];
  sortOrder: number;
}

interface PermissionSeed {
  id: string;
  key: string;
  label: string;
  description: string | null;
  feature: string | null;
  platformOnly: boolean;
  adminOnly: boolean;
  sortOrder: number;
}

interface AccessLevelSeed {
  id: string;
  resource: AccessResource;
  key: string;
  rank: number;
  label: string;
  description: string | null;
}

interface RoleSeed {
  id: string;
  tier: RoleTier;
  name: string;
  description: string | null;
  permissions: string[];
}

interface ConnectorSeed {
  id: string;
  name: string;
  status: ConnectorStatus;
  description: string | null;
  docsUrl: string | null;
  credentials: Prisma.InputJsonValue;
  sortOrder: number;
}

interface CreditRateSeed {
  action: string;
  label: string;
  description: string | null;
  credits: string;
  sortOrder: number;
}

interface AuditEventTypeSeed {
  key: string;
  label: string;
  categories: string[];
  action: AuditAction | null;
  sortOrder: number;
}

const FEATURES: FeatureSeed[] = [
  {
    id: 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1',
    key: 'metadata_lakehouse',
    label: 'Metadata Lakehouse',
    description: 'Connect a warehouse, build and publish the business context every agent reads.',
    locked: true,
    hidden: false,
    covers: ['Metadata Lakehouse'],
    sortOrder: 0,
  },
  {
    id: 'f9dbb017-fd03-4543-be26-1532bd30fab4',
    key: 'data_analyst',
    label: 'Data analyst agent',
    description: 'Chat with the data analyst, and build, run and schedule playbooks.',
    locked: false,
    hidden: false,
    covers: ['Data analyst', 'Playbooks'],
    sortOrder: 1,
  },
  {
    id: '92353e69-80c5-4629-96ef-a334ce371e81',
    key: 'agents',
    label: 'Agents',
    description: 'Build custom agents on published contexts, chat with them and schedule them.',
    locked: false,
    hidden: true,
    covers: ['Agents'],
    sortOrder: 2,
  },
  {
    id: '94f51f0f-2951-4381-9e80-33c82bd8dc11',
    key: 'dashboards',
    label: 'Dashboards',
    description: 'BI dashboards, their sharing and data scopes, and the data sources behind them.',
    locked: false,
    hidden: true,
    covers: ['Dashboards', 'Data sources', 'Dashboard access'],
    sortOrder: 3,
  },
];

const PERMISSIONS: PermissionSeed[] = [
  {
    id: '25b11a0f-e42e-4e4d-aebf-06abb0ecf4c1',
    key: 'company.read',
    label: 'View Companies',
    description: 'See companies and their details.',
    feature: null,
    platformOnly: false,
    adminOnly: false,
    sortOrder: 0,
  },
  {
    id: 'aabdaaf6-f03a-4d7c-96d9-1f6d3b069f13',
    key: 'company.create',
    label: 'Create Companies',
    description: 'Onboard a new customer company.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 1,
  },
  {
    id: 'ea9d9b78-9ca4-4eb9-8e7b-04fb780f05dd',
    key: 'company.update',
    label: 'Update Companies',
    description: 'Rename a company, or activate and deactivate it.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 2,
  },
  {
    id: '409c9b3d-a84c-440d-a7c5-994dbc9a6acb',
    key: 'company.delete',
    label: 'Delete Companies',
    description: 'Permanently remove a company and everything inside it.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 3,
  },
  {
    id: '3a261a33-e359-47bd-acaa-65afddeae671',
    key: 'company.features',
    label: 'Manage Company Features',
    description: 'Switch the features a company has on or off.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 4,
  },
  {
    id: 'bbfea992-e3ee-42a9-a479-f0a828c182d4',
    key: 'user.read',
    label: 'View Users',
    description: 'See the user directory and individual accounts.',
    feature: null,
    platformOnly: false,
    adminOnly: false,
    sortOrder: 5,
  },
  {
    id: '81c2a6a0-eb5c-41ba-83d4-53802c18d8af',
    key: 'user.create',
    label: 'Create Users',
    description: 'Onboard new accounts and send their activation email.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 6,
  },
  {
    id: 'edfd461e-eac9-4067-931e-a7dc7c22deaa',
    key: 'user.update',
    label: 'Update Users',
    description: 'Change an account’s role, and reissue its activation link.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 7,
  },
  {
    id: '674255bc-8a99-4b01-a143-df7ace6a65e6',
    key: 'user.delete',
    label: 'Delete Users',
    description: 'Permanently remove accounts.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 8,
  },
  {
    id: '08e2331b-d946-4936-b254-44c61d399f9c',
    key: 'user.activate',
    label: 'Activate Users',
    description: 'Re-enable a deactivated account.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 9,
  },
  {
    id: '699bfe3a-76bc-420b-a600-d9863dcab485',
    key: 'user.deactivate',
    label: 'Deactivate Users',
    description: 'Disable an account and end its sessions.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 10,
  },
  {
    id: '8c379452-4769-4c84-a4be-12632b1e35d1',
    key: 'role.read',
    label: 'View Roles',
    description: 'See the roles and the permissions each one holds.',
    feature: null,
    platformOnly: false,
    adminOnly: false,
    sortOrder: 11,
  },
  {
    id: '1efce2a2-0576-443c-8f6a-5b6db4ef8c31',
    key: 'role.update',
    label: 'Manage Role Permissions',
    description: 'Change which permissions a built-in role holds, for every company.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 12,
  },
  {
    id: '6cf252de-9c65-4ecb-a044-2603cb57d0c4',
    key: 'role.create',
    label: 'Create Company Roles',
    description: 'Create a custom role in your company.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 13,
  },
  {
    id: 'de4cca58-2f64-4dbb-b97b-f3c00f20491d',
    key: 'role.edit',
    label: 'Edit Company Roles',
    description: 'Rename a custom role and change its permissions.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 14,
  },
  {
    id: '9876ed7d-4763-4b87-b9f9-8f2fa4c3c961',
    key: 'role.delete',
    label: 'Delete Company Roles',
    description: 'Delete a custom role no member holds.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 15,
  },
  {
    id: '59d59584-88f0-4dce-a964-842d86442060',
    key: 'group.read',
    label: 'View Groups',
    description: 'See groups and their membership.',
    feature: null,
    platformOnly: false,
    adminOnly: false,
    sortOrder: 16,
  },
  {
    id: 'f10b1f92-5763-4240-bd60-1802babe0527',
    key: 'group.create',
    label: 'Create Groups',
    description: 'Create groups within the company.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 17,
  },
  {
    id: 'f31de92f-9642-45bb-8e94-f76ee6b20e02',
    key: 'group.update',
    label: 'Update Groups',
    description: 'Rename groups and change their membership.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 18,
  },
  {
    id: 'f2917a3f-9b07-4d0b-b6ad-3f4f364a6066',
    key: 'group.delete',
    label: 'Delete Groups',
    description: 'Delete groups and the access they carry.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 19,
  },
  {
    id: '77dfe7d4-1115-41a5-a16d-97069c98c48c',
    key: 'access.read',
    label: 'View Access',
    description: 'See who has been granted which dashboard.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 20,
  },
  {
    id: 'ee9b1bd0-f175-40f6-8b65-482b362f5893',
    key: 'access.grant',
    label: 'Grant Access',
    description: 'Give a user or group access to a dashboard.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 21,
  },
  {
    id: '2a8414a4-e6d3-42a0-8e95-a6c2eeceea7e',
    key: 'access.revoke',
    label: 'Revoke Access',
    description: 'Take dashboard access away from a user or group.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 22,
  },
  {
    id: '1e61c36d-a147-4c52-86c6-1efcad204558',
    key: 'dashboard.read',
    label: 'Open Dashboards',
    description: 'Open a dashboard that has been granted to you.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 23,
  },
  {
    id: 'f5c12def-b22b-4d63-b925-1865d353b7ce',
    key: 'dashboard.create',
    label: 'Create Dashboards',
    description: 'Create new dashboards.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 24,
  },
  {
    id: '72eafd38-3ce0-4c7a-9838-131ae77cc35a',
    key: 'dashboard.update',
    label: 'Edit Dashboards',
    description: 'Change the card configuration of a dashboard.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 25,
  },
  {
    id: 'd8d7acf0-d7a0-45d5-834d-79bad948ff92',
    key: 'dashboard.delete',
    label: 'Delete Dashboards',
    description: 'Permanently remove a dashboard.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 26,
  },
  {
    id: '5d52979f-2d66-4015-a3f7-dd766def2abb',
    key: 'dashboard.assign',
    label: 'Assign Dashboards',
    description: 'Decide which dashboards a company may use.',
    feature: 'dashboards',
    platformOnly: true,
    adminOnly: false,
    sortOrder: 27,
  },
  {
    id: 'ea4285b7-3a39-4b08-9b96-4d89cb2697f7',
    key: 'data.read',
    label: 'Read Data',
    description: 'Read the source tables behind a granted dashboard.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 28,
  },
  {
    id: '347eb6ed-ea14-4c2b-a215-1d60dc52eaa0',
    key: 'context.read',
    label: 'View Metadata Lakehouse',
    description: 'See the connections, contexts and published versions of your company.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 29,
  },
  {
    id: 'dfbe89db-114d-4c38-9934-c12715407ceb',
    key: 'context.create',
    label: 'Create Contexts',
    description: 'Connect a data warehouse to start a new context.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 30,
  },
  {
    id: 'a31ef6fb-b600-4d10-bddc-aa8a90600ee4',
    key: 'context.update',
    label: 'Edit Contexts',
    description:
      'Choose datasets, run the AI analysis, edit and review facts, start a new version and share a context.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 31,
  },
  {
    id: '4f8a83ea-1d6e-41d9-a453-9907ea285121',
    key: 'context.publish',
    label: 'Publish Contexts',
    description: 'Publish a draft as a new version that agents read.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 32,
  },
  {
    id: 'dd73ca5f-92e3-480a-8cb5-7024229ec780',
    key: 'context.delete',
    label: 'Delete Contexts',
    description: 'Delete a connection or a published version.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 33,
  },
  {
    id: 'c83b79fd-2d9f-46ae-b12b-bc486a4b61aa',
    key: 'context.manage_all',
    label: 'Manage Every Context',
    description: 'Open, edit and delete every context of your company, not only your own and the ones shared with you.',
    feature: 'metadata_lakehouse',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 34,
  },
  {
    id: 'b1b68eaa-e599-4488-bd79-c17f02299321',
    key: 'analyst.use',
    label: 'Use Data Analyst',
    description: 'Chat with the data analyst agent and manage your own chats.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 35,
  },
  {
    id: '65e7d4f9-f9c5-46c4-a246-0c29ed378268',
    key: 'playbook.read',
    label: 'View Playbooks',
    description: 'See playbooks, their runs and schedules.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 36,
  },
  {
    id: 'dea45e30-f930-477d-ab6f-93ca73ac6bbf',
    key: 'playbook.create',
    label: 'Create Playbooks',
    description: 'Build playbooks with the Playbook Builder.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 37,
  },
  {
    id: '842fd937-93c2-4789-9928-7f2cd8a74565',
    key: 'playbook.update',
    label: 'Edit Playbooks',
    description: 'Change an existing playbook.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 38,
  },
  {
    id: 'b1e815b5-561c-42b2-a9bc-6f58d5da64b9',
    key: 'playbook.delete',
    label: 'Delete Playbooks',
    description: 'Permanently remove a playbook.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 39,
  },
  {
    id: '9f5246e9-bb69-4ad0-b7f5-c955a7f6827d',
    key: 'playbook.run',
    label: 'Run Playbooks',
    description: 'Run a playbook and manage its schedules.',
    feature: 'data_analyst',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 40,
  },
  {
    id: '2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8',
    key: 'agent.read',
    label: 'View Agents',
    description: 'See the agents library and chat with an agent.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 41,
  },
  {
    id: 'b659cb7f-562c-4487-8fde-b51e5d269a91',
    key: 'agent.create',
    label: 'Create Agents',
    description: 'Create a new agent on published contexts.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 42,
  },
  {
    id: '1e1e2e84-555d-477d-9bb9-86950d979681',
    key: 'agent.update',
    label: 'Edit Agents',
    description: 'Change the agents you created.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 43,
  },
  {
    id: '1a15c2b1-f63f-4013-9588-f8141649fdeb',
    key: 'agent.delete',
    label: 'Delete Agents',
    description: 'Delete the agents you created.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 44,
  },
  {
    id: '314cd364-c82a-40dc-8c3d-d12257181285',
    key: 'agent.schedule',
    label: 'Schedule Agents',
    description: 'Set or clear the schedule of the agents you created.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 45,
  },
  {
    id: '232b52e5-81b8-4d37-86d6-f96e4361f4cf',
    key: 'agent.manage_all',
    label: 'Manage Everyone’s Agents',
    description: 'Edit, delete and schedule agents other people created.',
    feature: 'agents',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 46,
  },
  {
    id: '2e3129c4-6a5c-4abd-9629-84d09819beaf',
    key: 'scope.read',
    label: 'View Data Scopes',
    description: 'See the row-level scopes assigned to a user.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: false,
    sortOrder: 47,
  },
  {
    id: 'b0171ac6-9d88-4c95-bb29-bb88a288baad',
    key: 'scope.update',
    label: 'Update Data Scopes',
    description: 'Assign row-level data scopes to a user.',
    feature: 'dashboards',
    platformOnly: false,
    adminOnly: true,
    sortOrder: 48,
  },
  {
    id: '723b3e13-f73b-41da-a703-472987c01eb3',
    key: 'delete.permanent',
    label: 'Delete Permanently',
    description: 'Remove a record from the database for good instead of keeping it as deleted.',
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 49,
  },
  {
    id: '7c611b04-1e1d-4e6a-b65e-ba1572ccc1cb',
    key: 'credits.manage',
    label: 'Manage Credits',
    description: "See the company's credit usage and restrict how many credits a member can use.",
    feature: null,
    platformOnly: false,
    adminOnly: true,
    sortOrder: 50,
  },
  {
    id: '21fc5e8f-dbd3-405a-8e67-cb8584c5aa29',
    key: 'credits.allocate',
    label: 'Allocate Credits',
    description: 'Give companies credits, take credits back, and set what each AI action costs.',
    feature: null,
    platformOnly: true,
    adminOnly: false,
    sortOrder: 51,
  },
  {
    id: '76ea04b2-3679-4610-b89d-6de07fd7496c',
    key: 'audit.read',
    label: 'View Audit Log',
    description:
      'See the audit log of everyone in scope: the whole company, or every company for a platform account. Without it, only your own activity.',
    feature: null,
    platformOnly: false,
    adminOnly: false,
    sortOrder: 52,
  },
];

const ACCESS_LEVELS: AccessLevelSeed[] = [
  {
    id: '5307098d-f2b9-4bb1-bb6f-17d0157fc497',
    resource: 'dashboard',
    key: 'view',
    rank: 1,
    label: 'Can view',
    description: 'Open the dashboard and use its slicers.',
  },
  {
    id: '069b9393-83ee-435b-af07-0fdb1f74ab86',
    resource: 'dashboard',
    key: 'share',
    rank: 2,
    label: 'Can share',
    description: 'View, plus grant other users in the company access to it.',
  },
  {
    id: '24417946-56df-4344-9958-c0ba26c1d8af',
    resource: 'dashboard',
    key: 'developer',
    rank: 3,
    label: 'Can edit',
    description: 'Share, plus change the dashboard card configuration.',
  },
  {
    id: '76f9f133-68d9-41ef-8ed1-a92c65c53135',
    resource: 'dashboard',
    key: 'admin',
    rank: 4,
    label: 'Full control',
    description: 'Developer, plus full control of the dashboard and its grants.',
  },
  {
    id: 'd3128419-d42c-4783-b651-6d7f176cc813',
    resource: 'context',
    key: 'view',
    rank: 1,
    label: 'Can view',
    description: 'Open the draft and every published version, read-only.',
  },
  {
    id: 'b867ada1-5e89-4675-8792-951b56d1695d',
    resource: 'context',
    key: 'edit',
    rank: 2,
    label: 'Can edit',
    description: 'Also change the draft: datasets, analysis, review and descriptions.',
  },
  {
    id: '80bb5d1c-7589-485f-b1cd-32fe6993d8b3',
    resource: 'context',
    key: 'full',
    rank: 3,
    label: 'Full access',
    description: 'Also delete the context and its published versions.',
  },
];

const SYSTEM_ROLES: RoleSeed[] = [
  {
    id: 'b81ad886-d47f-4978-8bfd-e8c28d745c81',
    tier: 'SUPER_ADMIN',
    name: 'Platform owner',
    description: 'Platform owner. Manages every company, user, role and dashboard assignment.',
    permissions: [
      'company.read',
      'company.create',
      'company.update',
      'company.delete',
      'company.features',
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.activate',
      'user.deactivate',
      'role.read',
      'role.update',
      'role.create',
      'role.edit',
      'role.delete',
      'group.read',
      'group.create',
      'group.update',
      'group.delete',
      'access.read',
      'access.grant',
      'access.revoke',
      'dashboard.read',
      'dashboard.create',
      'dashboard.update',
      'dashboard.delete',
      'dashboard.assign',
      'data.read',
      'context.read',
      'context.create',
      'context.update',
      'context.publish',
      'context.delete',
      'context.manage_all',
      'analyst.use',
      'playbook.read',
      'playbook.create',
      'playbook.update',
      'playbook.delete',
      'playbook.run',
      'agent.read',
      'agent.create',
      'agent.update',
      'agent.delete',
      'agent.schedule',
      'agent.manage_all',
      'scope.read',
      'scope.update',
      'delete.permanent',
      'credits.manage',
      'credits.allocate',
      'audit.read',
    ],
  },
  {
    id: '6686f739-2e9f-4c62-8df3-eeaf69e85b5e',
    tier: 'PLATFORM_ADMIN',
    name: 'Platform admin',
    description:
      'Platform administrator created by the platform owner. Manages companies and their accounts; cannot see or manage platform accounts.',
    permissions: [
      'company.read',
      'company.create',
      'company.update',
      'company.delete',
      'company.features',
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.activate',
      'user.deactivate',
      'role.read',
      'role.create',
      'role.edit',
      'role.delete',
      'group.read',
      'group.create',
      'group.update',
      'group.delete',
      'access.read',
      'access.grant',
      'access.revoke',
      'dashboard.read',
      'dashboard.create',
      'dashboard.update',
      'dashboard.delete',
      'dashboard.assign',
      'data.read',
      'context.read',
      'context.create',
      'context.update',
      'context.publish',
      'context.delete',
      'context.manage_all',
      'analyst.use',
      'playbook.read',
      'playbook.create',
      'playbook.update',
      'playbook.delete',
      'playbook.run',
      'agent.read',
      'agent.create',
      'agent.update',
      'agent.delete',
      'agent.schedule',
      'agent.manage_all',
      'scope.read',
      'scope.update',
      'delete.permanent',
      'credits.manage',
      'credits.allocate',
      'audit.read',
    ],
  },
  {
    id: '301f455d-b2f0-4a7c-82db-66ed9fe2fd9d',
    tier: 'COMPANY_ADMIN',
    name: 'Company admin',
    description: 'Administrator of one company. Manages that company’s users, groups and access.',
    permissions: [
      'company.read',
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.activate',
      'user.deactivate',
      'role.read',
      'role.create',
      'role.edit',
      'role.delete',
      'group.read',
      'group.create',
      'group.update',
      'group.delete',
      'access.read',
      'access.grant',
      'access.revoke',
      'dashboard.read',
      'dashboard.create',
      'dashboard.update',
      'dashboard.delete',
      'data.read',
      'context.read',
      'context.create',
      'context.update',
      'context.publish',
      'context.delete',
      'context.manage_all',
      'analyst.use',
      'playbook.read',
      'playbook.create',
      'playbook.update',
      'playbook.delete',
      'playbook.run',
      'agent.read',
      'agent.create',
      'agent.update',
      'agent.delete',
      'agent.schedule',
      'agent.manage_all',
      'scope.read',
      'scope.update',
      'delete.permanent',
      'credits.manage',
      'audit.read',
    ],
  },
  {
    id: '3f1c0146-ec04-43b6-85ba-6b27f7f60a28',
    tier: 'USER',
    name: 'Member',
    description: 'Member of one company. Reaches only the resources explicitly granted to them.',
    permissions: [
      'dashboard.read',
      'dashboard.create',
      'dashboard.update',
      'data.read',
      'context.read',
      'context.update',
      'context.delete',
      'analyst.use',
      'playbook.read',
      'playbook.create',
      'playbook.update',
      'playbook.run',
      'agent.read',
      'agent.create',
      'agent.update',
      'agent.schedule',
    ],
  },
];

const CONNECTORS: ConnectorSeed[] = [
  {
    id: 'domo',
    name: 'Domo',
    status: 'available',
    description: 'Connect with a Domo access token and pick the datasets to build a context from.',
    docsUrl: 'https://domo-support.domo.com/s/article/360042934494',
    credentials: [
      {
        id: 'name',
        help: 'How this connection appears in your workspace.',
        type: 'text',
        label: 'Connection name',
        placeholder: 'Sales',
      },
      {
        id: 'host',
        help: 'The address you sign in to. An access token is issued by one instance and is only valid there.',
        type: 'text',
        label: 'Domo instance',
        placeholder: 'acme.domo.com',
      },
      {
        id: 'token',
        help: 'Domo → Admin → Authentication → Access tokens. Stored encrypted and never shown again.',
        type: 'secret',
        label: 'Developer access token',
        placeholder: '',
      },
    ],
    sortOrder: 0,
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    status: 'planned',
    description: 'Account, warehouse, database and a key-pair or password credential.',
    docsUrl: null,
    credentials: [],
    sortOrder: 1,
  },
  {
    id: 'databricks',
    name: 'Databricks',
    status: 'planned',
    description: 'Workspace URL, SQL warehouse and a personal access token.',
    docsUrl: null,
    credentials: [],
    sortOrder: 2,
  },
  {
    id: 'bigquery',
    name: 'BigQuery',
    status: 'planned',
    description: 'Project, dataset and a service-account key.',
    docsUrl: null,
    credentials: [],
    sortOrder: 3,
  },
  {
    id: 'redshift',
    name: 'Amazon Redshift',
    status: 'planned',
    description: 'Cluster endpoint, database and credentials.',
    docsUrl: null,
    credentials: [],
    sortOrder: 4,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    status: 'planned',
    description: 'Host, database and a read-only role.',
    docsUrl: null,
    credentials: [],
    sortOrder: 5,
  },
];

const CREDIT_RATES: CreditRateSeed[] = [
  {
    action: 'context.build',
    label: 'Build or refresh a context',
    description:
      'Each AI run that reads the selected datasets and writes the context: a first build, a re-run, or a refresh with new or changed datasets.',
    credits: '2.00',
    sortOrder: 0,
  },
  {
    action: 'context.chat',
    label: 'Understand chat message',
    description: 'Each message sent to the description editor on the Understand step.',
    credits: '0.20',
    sortOrder: 1,
  },
  {
    action: 'analyst.question',
    label: 'Data analyst question',
    description: 'Each question asked to the data analyst.',
    credits: '0.50',
    sortOrder: 2,
  },
];

const AUDIT_EVENT_TYPES: AuditEventTypeSeed[] = [
  { key: 'login_success', label: 'login success', categories: ['auth'], action: null, sortOrder: 0 },
  { key: 'login_failed', label: 'login failed', categories: ['auth'], action: null, sortOrder: 1 },
  { key: 'login_blocked', label: 'login blocked', categories: ['auth'], action: null, sortOrder: 2 },
  { key: 'logout', label: 'logout', categories: ['auth'], action: null, sortOrder: 3 },
  { key: 'session_refreshed', label: 'session refreshed', categories: ['auth'], action: null, sortOrder: 4 },
  { key: 'session_revoked', label: 'session revoked', categories: ['auth'], action: 'delete', sortOrder: 5 },
  { key: 'refresh_reuse_detected', label: 'refresh reuse detected', categories: ['auth'], action: null, sortOrder: 6 },
  { key: 'password_changed', label: 'password changed', categories: ['auth'], action: 'update', sortOrder: 7 },
  { key: 'account_activated', label: 'account activated', categories: ['auth'], action: 'create', sortOrder: 8 },
  {
    key: 'company_created',
    label: 'company created',
    categories: ['company', 'companies'],
    action: 'create',
    sortOrder: 9,
  },
  {
    key: 'company_updated',
    label: 'company updated',
    categories: ['company', 'companies'],
    action: 'update',
    sortOrder: 10,
  },
  {
    key: 'company_deleted',
    label: 'company deleted',
    categories: ['company', 'companies'],
    action: 'delete',
    sortOrder: 11,
  },
  {
    key: 'company_features_updated',
    label: 'company features updated',
    categories: ['company', 'companies'],
    action: 'update',
    sortOrder: 12,
  },
  { key: 'user_created', label: 'user created', categories: ['people'], action: 'create', sortOrder: 13 },
  { key: 'user_updated', label: 'user updated', categories: ['people'], action: 'update', sortOrder: 14 },
  { key: 'user_deleted', label: 'user deleted', categories: ['people'], action: 'delete', sortOrder: 15 },
  { key: 'user_activated', label: 'user activated', categories: ['people'], action: 'create', sortOrder: 16 },
  { key: 'user_deactivated', label: 'user deactivated', categories: ['people'], action: 'delete', sortOrder: 17 },
  {
    key: 'user_activation_resent',
    label: 'user activation resent',
    categories: ['people'],
    action: 'update',
    sortOrder: 18,
  },
  { key: 'user_scope_updated', label: 'user scope updated', categories: ['people'], action: 'update', sortOrder: 19 },
  {
    key: 'user_permissions_updated',
    label: 'user permissions updated',
    categories: ['people'],
    action: 'update',
    sortOrder: 20,
  },
  {
    key: 'role_permissions_updated',
    label: 'role permissions updated',
    categories: ['people'],
    action: 'update',
    sortOrder: 21,
  },
  { key: 'role_created', label: 'role created', categories: ['people'], action: 'create', sortOrder: 22 },
  { key: 'role_updated', label: 'role updated', categories: ['people'], action: 'update', sortOrder: 23 },
  { key: 'role_deleted', label: 'role deleted', categories: ['people'], action: 'delete', sortOrder: 24 },
  { key: 'group_created', label: 'group created', categories: ['people'], action: 'create', sortOrder: 25 },
  { key: 'group_updated', label: 'group updated', categories: ['people'], action: 'update', sortOrder: 26 },
  { key: 'group_deleted', label: 'group deleted', categories: ['people'], action: 'delete', sortOrder: 27 },
  {
    key: 'dashboard_created',
    label: 'dashboard created',
    categories: ['company', 'dashboards'],
    action: 'create',
    sortOrder: 28,
  },
  {
    key: 'dashboard_assigned',
    label: 'dashboard assigned',
    categories: ['company', 'dashboards'],
    action: 'create',
    sortOrder: 29,
  },
  {
    key: 'dashboard_unassigned',
    label: 'dashboard unassigned',
    categories: ['company', 'dashboards'],
    action: 'delete',
    sortOrder: 30,
  },
  {
    key: 'dashboard_updated',
    label: 'dashboard updated',
    categories: ['company', 'dashboards'],
    action: 'update',
    sortOrder: 31,
  },
  {
    key: 'dashboard_deleted',
    label: 'dashboard deleted',
    categories: ['company', 'dashboards'],
    action: 'delete',
    sortOrder: 32,
  },
  {
    key: 'access_granted',
    label: 'access granted',
    categories: ['company', 'dashboards'],
    action: 'create',
    sortOrder: 33,
  },
  {
    key: 'access_revoked',
    label: 'access revoked',
    categories: ['company', 'dashboards'],
    action: 'delete',
    sortOrder: 34,
  },
  { key: 'access_denied', label: 'access denied', categories: ['dashboards'], action: null, sortOrder: 35 },
  {
    key: 'context_connection_created',
    label: 'Lakehouse connection created',
    categories: ['company', 'lakehouse'],
    action: 'create',
    sortOrder: 36,
  },
  {
    key: 'context_connection_deleted',
    label: 'Lakehouse connection deleted',
    categories: ['company', 'lakehouse'],
    action: 'delete',
    sortOrder: 37,
  },
  {
    key: 'context_version_created',
    label: 'Lakehouse version created',
    categories: ['company', 'lakehouse'],
    action: 'create',
    sortOrder: 38,
  },
  {
    key: 'context_profile_saved',
    label: 'context profile saved',
    categories: ['company', 'lakehouse'],
    action: null,
    sortOrder: 39,
  },
  {
    key: 'context_fact_updated',
    label: 'Lakehouse fact edited',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 40,
  },
  {
    key: 'context_datasets_selected',
    label: 'Lakehouse datasets updated',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 41,
  },
  {
    key: 'context_review_decided',
    label: 'Lakehouse fact reviewed',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 42,
  },
  {
    key: 'context_published',
    label: 'Lakehouse context published',
    categories: ['company', 'lakehouse'],
    action: 'create',
    sortOrder: 43,
  },
  {
    key: 'context_version_deleted',
    label: 'Lakehouse version deleted',
    categories: ['company', 'lakehouse'],
    action: 'delete',
    sortOrder: 44,
  },
  {
    key: 'context_extraction_run',
    label: 'Lakehouse extraction run',
    categories: ['company', 'lakehouse'],
    action: null,
    sortOrder: 45,
  },
  {
    key: 'context_access_granted',
    label: 'Lakehouse context shared',
    categories: ['company', 'lakehouse'],
    action: 'create',
    sortOrder: 46,
  },
  {
    key: 'context_access_updated',
    label: 'Lakehouse sharing changed',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 47,
  },
  {
    key: 'context_access_revoked',
    label: 'Lakehouse access removed',
    categories: ['company', 'lakehouse'],
    action: 'delete',
    sortOrder: 48,
  },
  {
    key: 'password_reset_requested',
    label: 'password reset requested',
    categories: ['auth'],
    action: null,
    sortOrder: 49,
  },
  { key: 'password_reset', label: 'password reset', categories: ['auth'], action: 'update', sortOrder: 50 },
  {
    key: 'company_restored',
    label: 'company restored',
    categories: ['company', 'companies'],
    action: 'update',
    sortOrder: 51,
  },
  { key: 'user_restored', label: 'user restored', categories: ['people'], action: 'update', sortOrder: 52 },
  { key: 'role_restored', label: 'role restored', categories: ['people'], action: 'update', sortOrder: 53 },
  { key: 'group_restored', label: 'group restored', categories: ['people'], action: 'update', sortOrder: 54 },
  {
    key: 'context_connection_restored',
    label: 'Lakehouse connection restored',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 55,
  },
  {
    key: 'context_version_restored',
    label: 'Lakehouse version restored',
    categories: ['company', 'lakehouse'],
    action: 'update',
    sortOrder: 56,
  },
  {
    key: 'credits_allocated',
    label: 'credits allocated',
    categories: ['company', 'credits'],
    action: 'create',
    sortOrder: 57,
  },
  {
    key: 'credit_limit_updated',
    label: 'credit limit changed',
    categories: ['company', 'credits'],
    action: 'update',
    sortOrder: 58,
  },
  {
    key: 'credit_rate_updated',
    label: 'credit price changed',
    categories: ['credits'],
    action: 'update',
    sortOrder: 59,
  },
];

function idOf(list: { id: string; key: string }[], key: string): string {
  const found = list.find((row) => row.key === key);
  if (!found) throw new Error(`prisma/seed.ts names "${key}", which it does not define.`);
  return found.id;
}

async function seedCatalogue(tx: Tx): Promise<void> {
  await tx.feature.createMany({ data: FEATURES, skipDuplicates: true });
  await tx.permission.createMany({
    data: PERMISSIONS.map(({ feature, ...permission }) => ({
      ...permission,
      featureId: feature ? idOf(FEATURES, feature) : null,
    })),
    skipDuplicates: true,
  });
  await tx.accessLevel.createMany({ data: ACCESS_LEVELS, skipDuplicates: true });
  await tx.role.createMany({
    data: SYSTEM_ROLES.map(({ permissions, ...role }) => ({ ...role, companyId: null, kind: 'system' as const })),
    skipDuplicates: true,
  });
  await tx.rolePermissions.createMany({
    data: SYSTEM_ROLES.map((role) => ({
      roleId: role.id,
      permissionIds: role.permissions.map((key) => idOf(PERMISSIONS, key)),
    })),
    skipDuplicates: true,
  });
  await tx.connector.createMany({ data: CONNECTORS, skipDuplicates: true });
  await tx.creditRate.createMany({ data: CREDIT_RATES, skipDuplicates: true });
  await tx.auditEventType.createMany({ data: AUDIT_EVENT_TYPES, skipDuplicates: true });
}

async function seedPlatformOwner(): Promise<boolean> {
  if ((await prisma.user.count()) > 0) return false;

  const owner = SYSTEM_ROLES.find((role) => role.tier === 'SUPER_ADMIN');
  if (!owner) throw new Error('prisma/seed.ts has no SUPER_ADMIN role.');
  const { username, email, password } = bootstrapSuperAdmin();
  await withTransaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        companyId: null,
        username,
        email: String(email).toLowerCase(),
        passwordHash: hashPassword(password),
        status: 'active',
        mustChangePassword: true,
      },
      select: { id: true },
    });
    await tx.userRole.create({ data: { userId: user.id, roleId: owner.id } });
  });
  console.log(
    `[seed] created platform owner "${username}" as SUPER_ADMIN, flagged to change its password at first sign-in`
  );
  return true;
}

async function seed(): Promise<void> {
  await withTransaction((tx) => seedCatalogue(tx));
  await seedPlatformOwner();
}

type Row = Record<string, unknown>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable((value as Row)[key])])
    );
  }
  return value;
}

function compare(table: string, key: string, expected: Row[], actual: Row[]): string[] {
  const differences: string[] = [];
  const remaining = new Map(actual.map((row) => [String(row[key]), row]));
  for (const row of expected) {
    const id = String(row[key]);
    const found = remaining.get(id);
    remaining.delete(id);
    if (!found) {
      differences.push(`${table} "${id}": in prisma/seed.ts, missing from the database`);
      continue;
    }
    for (const [field, value] of Object.entries(row)) {
      const have = JSON.stringify(stable(found[field]));
      const want = JSON.stringify(stable(value));
      if (have !== want)
        differences.push(`${table} "${id}": ${field} is ${have} in the database, ${want} in prisma/seed.ts`);
    }
  }
  for (const id of remaining.keys()) differences.push(`${table} "${id}": in the database, missing from prisma/seed.ts`);
  return differences;
}

async function seedDifferences(): Promise<string[]> {
  const [features, permissions, accessLevels, roles, connectors, creditRates, auditEventTypes] = await Promise.all([
    prisma.feature.findMany(),
    prisma.permission.findMany(),
    prisma.accessLevel.findMany(),
    prisma.role.findMany({ where: { companyId: null }, include: { permissions: true } }),
    prisma.connector.findMany(),
    prisma.creditRate.findMany(),
    prisma.auditEventType.findMany(),
  ]);
  const featureKeys = new Map(features.map((f) => [f.id, f.key]));
  const permissionKeys = new Map(permissions.map((p) => [p.id, p.key]));
  const pick = <T extends object>(row: T, fields: string[]): Row =>
    Object.fromEntries(fields.map((field) => [field, (row as Row)[field]]));

  return [
    ...compare(
      'features',
      'key',
      FEATURES as unknown as Row[],
      features.map((f) => pick(f, Object.keys(FEATURES[0])))
    ),
    ...compare(
      'permissions',
      'key',
      PERMISSIONS as unknown as Row[],
      permissions.map(({ featureId, ...p }) => ({
        ...pick(p, Object.keys(PERMISSIONS[0])),
        feature: featureId ? (featureKeys.get(featureId) ?? featureId) : null,
      }))
    ),
    ...compare(
      'access_levels',
      'id',
      ACCESS_LEVELS as unknown as Row[],
      accessLevels.map((a) => pick(a, Object.keys(ACCESS_LEVELS[0])))
    ),
    ...compare(
      'roles',
      'tier',
      SYSTEM_ROLES.map((role) => ({ ...role, permissions: [...role.permissions].sort() })),
      roles.map((r) => ({
        ...pick(r, ['id', 'tier', 'name', 'description']),
        permissions: (r.permissions?.permissionIds ?? []).map((id) => permissionKeys.get(id) ?? id).sort(),
      }))
    ),
    ...compare(
      'connectors',
      'id',
      CONNECTORS as unknown as Row[],
      connectors.map((c) => pick(c, Object.keys(CONNECTORS[0])))
    ),
    ...compare(
      'credit_rates',
      'action',
      CREDIT_RATES as unknown as Row[],
      creditRates.map((c) => ({ ...pick(c, Object.keys(CREDIT_RATES[0])), credits: c.credits.toFixed(2) }))
    ),
    ...compare(
      'audit_event_types',
      'key',
      AUDIT_EVENT_TYPES as unknown as Row[],
      auditEventTypes.map((a) => pick(a, Object.keys(AUDIT_EVENT_TYPES[0])))
    ),
  ];
}

async function main(args: string[]): Promise<number> {
  if (args.includes('--check')) {
    const differences = await seedDifferences();
    for (const line of differences) console.log(line);
    console.log(
      differences.length
        ? `[seed] ${differences.length} difference(s) between the database and prisma/seed.ts`
        : '[seed] the database matches prisma/seed.ts'
    );
    return differences.length ? 1 : 0;
  }
  await seed();
  console.log('[seed] catalogue and platform owner are in place');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(`[seed] failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}

export { seed, seedDifferences };
