CREATE TABLE "audit_event_types" (
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "action" VARCHAR(16),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_event_types_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "chk_audit_event_types_action" CHECK ("action" IN ('create', 'update', 'delete'))
);

CREATE TABLE "connectors" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "description" TEXT,
    "docs_url" TEXT,
    "credentials" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_connectors_status" CHECK ("status" IN ('available', 'planned')),
    CONSTRAINT "chk_connectors_credentials" CHECK (jsonb_typeof("credentials") = 'array')
);

INSERT INTO "access_control"."features" ("id", "key", "label", "description", "locked", "covers", "sort_order") VALUES
  ('b7f43f35-4987-46fe-94b5-5f64eb35c7a1', 'metadata_lakehouse', 'Metadata Lakehouse', 'Connect a warehouse, build and publish the business context every agent reads.', TRUE, ARRAY['Metadata Lakehouse']::text[], 0),
  ('f9dbb017-fd03-4543-be26-1532bd30fab4', 'data_analyst', 'Data analyst agent', 'Chat with the data analyst, and build, run and schedule playbooks.', FALSE, ARRAY['Data analyst', 'Playbooks']::text[], 1),
  ('92353e69-80c5-4629-96ef-a334ce371e81', 'agents', 'Agents', 'Build custom agents on published contexts, chat with them and schedule them.', FALSE, ARRAY['Agents']::text[], 2),
  ('94f51f0f-2951-4381-9e80-33c82bd8dc11', 'dashboards', 'Dashboards', 'BI dashboards, their sharing and data scopes, and the data sources behind them.', FALSE, ARRAY['Dashboards', 'Data sources', 'Dashboard access']::text[], 3)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."permissions" ("id", "key", "label", "description", "feature_id", "platform_only", "admin_only", "sort_order") VALUES
  ('25b11a0f-e42e-4e4d-aebf-06abb0ecf4c1', 'company.read', 'View Companies', 'See companies and their details.', NULL, FALSE, FALSE, 0),
  ('aabdaaf6-f03a-4d7c-96d9-1f6d3b069f13', 'company.create', 'Create Companies', 'Onboard a new customer company.', NULL, TRUE, FALSE, 1),
  ('ea9d9b78-9ca4-4eb9-8e7b-04fb780f05dd', 'company.update', 'Update Companies', 'Rename a company, or activate and deactivate it.', NULL, TRUE, FALSE, 2),
  ('409c9b3d-a84c-440d-a7c5-994dbc9a6acb', 'company.delete', 'Delete Companies', 'Permanently remove a company and everything inside it.', NULL, TRUE, FALSE, 3),
  ('3a261a33-e359-47bd-acaa-65afddeae671', 'company.features', 'Manage Company Features', 'Switch the features a company has on or off.', NULL, TRUE, FALSE, 4),
  ('bbfea992-e3ee-42a9-a479-f0a828c182d4', 'user.read', 'View Users', 'See the user directory and individual accounts.', NULL, FALSE, FALSE, 5),
  ('81c2a6a0-eb5c-41ba-83d4-53802c18d8af', 'user.create', 'Create Users', 'Onboard new accounts and send their activation email.', NULL, FALSE, TRUE, 6),
  ('edfd461e-eac9-4067-931e-a7dc7c22deaa', 'user.update', 'Update Users', 'Change an account’s role, and reissue its activation link.', NULL, FALSE, TRUE, 7),
  ('674255bc-8a99-4b01-a143-df7ace6a65e6', 'user.delete', 'Delete Users', 'Permanently remove accounts.', NULL, FALSE, TRUE, 8),
  ('08e2331b-d946-4936-b254-44c61d399f9c', 'user.activate', 'Activate Users', 'Re-enable a deactivated account.', NULL, FALSE, TRUE, 9),
  ('699bfe3a-76bc-420b-a600-d9863dcab485', 'user.deactivate', 'Deactivate Users', 'Disable an account and end its sessions.', NULL, FALSE, TRUE, 10),
  ('8c379452-4769-4c84-a4be-12632b1e35d1', 'role.read', 'View Roles', 'See the roles and the permissions each one holds.', NULL, FALSE, FALSE, 11),
  ('1efce2a2-0576-443c-8f6a-5b6db4ef8c31', 'role.update', 'Manage Role Permissions', 'Change which permissions a built-in role holds, for every company.', NULL, TRUE, FALSE, 12),
  ('6cf252de-9c65-4ecb-a044-2603cb57d0c4', 'role.create', 'Create Company Roles', 'Create a custom role in your company.', NULL, FALSE, TRUE, 13),
  ('de4cca58-2f64-4dbb-b97b-f3c00f20491d', 'role.edit', 'Edit Company Roles', 'Rename a custom role and change its permissions.', NULL, FALSE, TRUE, 14),
  ('9876ed7d-4763-4b87-b9f9-8f2fa4c3c961', 'role.delete', 'Delete Company Roles', 'Delete a custom role no member holds.', NULL, FALSE, TRUE, 15),
  ('59d59584-88f0-4dce-a964-842d86442060', 'group.read', 'View Groups', 'See groups and their membership.', NULL, FALSE, FALSE, 16),
  ('f10b1f92-5763-4240-bd60-1802babe0527', 'group.create', 'Create Groups', 'Create groups within the company.', NULL, FALSE, TRUE, 17),
  ('f31de92f-9642-45bb-8e94-f76ee6b20e02', 'group.update', 'Update Groups', 'Rename groups and change their membership.', NULL, FALSE, TRUE, 18),
  ('f2917a3f-9b07-4d0b-b6ad-3f4f364a6066', 'group.delete', 'Delete Groups', 'Delete groups and the access they carry.', NULL, FALSE, TRUE, 19),
  ('77dfe7d4-1115-41a5-a16d-97069c98c48c', 'access.read', 'View Access', 'See who has been granted which dashboard.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 20),
  ('ee9b1bd0-f175-40f6-8b65-482b362f5893', 'access.grant', 'Grant Access', 'Give a user or group access to a dashboard.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 21),
  ('2a8414a4-e6d3-42a0-8e95-a6c2eeceea7e', 'access.revoke', 'Revoke Access', 'Take dashboard access away from a user or group.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 22),
  ('1e61c36d-a147-4c52-86c6-1efcad204558', 'dashboard.read', 'Open Dashboards', 'Open a dashboard that has been granted to you.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 23),
  ('f5c12def-b22b-4d63-b925-1865d353b7ce', 'dashboard.create', 'Create Dashboards', 'Create new dashboards.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 24),
  ('72eafd38-3ce0-4c7a-9838-131ae77cc35a', 'dashboard.update', 'Edit Dashboards', 'Change the card configuration of a dashboard.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 25),
  ('d8d7acf0-d7a0-45d5-834d-79bad948ff92', 'dashboard.delete', 'Delete Dashboards', 'Permanently remove a dashboard.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 26),
  ('5d52979f-2d66-4015-a3f7-dd766def2abb', 'dashboard.assign', 'Assign Dashboards', 'Decide which dashboards a company may use.', NULL, TRUE, FALSE, 27),
  ('ea4285b7-3a39-4b08-9b96-4d89cb2697f7', 'data.read', 'Read Data', 'Read the source tables behind a granted dashboard.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 28),
  ('347eb6ed-ea14-4c2b-a215-1d60dc52eaa0', 'context.read', 'View Metadata Lakehouse', 'See the connections, contexts and published versions of your company.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 29),
  ('dfbe89db-114d-4c38-9934-c12715407ceb', 'context.create', 'Create Contexts', 'Connect a data warehouse and start a new context or version.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 30),
  ('a31ef6fb-b600-4d10-bddc-aa8a90600ee4', 'context.update', 'Edit Contexts', 'Choose datasets, run the AI analysis, edit and review facts.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 31),
  ('4f8a83ea-1d6e-41d9-a453-9907ea285121', 'context.publish', 'Publish Contexts', 'Publish a draft as a new version that agents read.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 32),
  ('dd73ca5f-92e3-480a-8cb5-7024229ec780', 'context.delete', 'Delete Contexts', 'Delete a connection or a published version.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 33),
  ('c83b79fd-2d9f-46ae-b12b-bc486a4b61aa', 'context.manage_all', 'Manage Every Context', 'Open, edit and delete every context of your company, not only your own and the ones shared with you.', 'b7f43f35-4987-46fe-94b5-5f64eb35c7a1', FALSE, FALSE, 34),
  ('b1b68eaa-e599-4488-bd79-c17f02299321', 'analyst.use', 'Use Data Analyst', 'Chat with the data analyst agent and manage your own chats.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 35),
  ('65e7d4f9-f9c5-46c4-a246-0c29ed378268', 'playbook.read', 'View Playbooks', 'See playbooks, their runs and schedules.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 36),
  ('dea45e30-f930-477d-ab6f-93ca73ac6bbf', 'playbook.create', 'Create Playbooks', 'Build playbooks with the Playbook Builder.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 37),
  ('842fd937-93c2-4789-9928-7f2cd8a74565', 'playbook.update', 'Edit Playbooks', 'Change an existing playbook.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 38),
  ('b1e815b5-561c-42b2-a9bc-6f58d5da64b9', 'playbook.delete', 'Delete Playbooks', 'Permanently remove a playbook.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 39),
  ('9f5246e9-bb69-4ad0-b7f5-c955a7f6827d', 'playbook.run', 'Run Playbooks', 'Run a playbook and manage its schedules.', 'f9dbb017-fd03-4543-be26-1532bd30fab4', FALSE, FALSE, 40),
  ('2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8', 'agent.read', 'View Agents', 'See the agents library and chat with an agent.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 41),
  ('b659cb7f-562c-4487-8fde-b51e5d269a91', 'agent.create', 'Create Agents', 'Create a new agent on published contexts.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 42),
  ('1e1e2e84-555d-477d-9bb9-86950d979681', 'agent.update', 'Edit Agents', 'Change the agents you created.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 43),
  ('1a15c2b1-f63f-4013-9588-f8141649fdeb', 'agent.delete', 'Delete Agents', 'Delete the agents you created.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 44),
  ('314cd364-c82a-40dc-8c3d-d12257181285', 'agent.schedule', 'Schedule Agents', 'Set or clear the schedule of the agents you created.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 45),
  ('232b52e5-81b8-4d37-86d6-f96e4361f4cf', 'agent.manage_all', 'Manage Everyone’s Agents', 'Edit, delete and schedule agents other people created.', '92353e69-80c5-4629-96ef-a334ce371e81', FALSE, FALSE, 46),
  ('2e3129c4-6a5c-4abd-9629-84d09819beaf', 'scope.read', 'View Data Scopes', 'See the row-level scopes assigned to a user.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, FALSE, 47),
  ('b0171ac6-9d88-4c95-bb29-bb88a288baad', 'scope.update', 'Update Data Scopes', 'Assign row-level data scopes to a user.', '94f51f0f-2951-4381-9e80-33c82bd8dc11', FALSE, TRUE, 48)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."access_levels" ("id", "resource", "key", "rank", "label", "description") VALUES
  ('5307098d-f2b9-4bb1-bb6f-17d0157fc497', 'dashboard', 'view', 1, 'Can view', 'Open the dashboard and use its slicers.'),
  ('069b9393-83ee-435b-af07-0fdb1f74ab86', 'dashboard', 'share', 2, 'Can share', 'View, plus grant other users in the company access to it.'),
  ('24417946-56df-4344-9958-c0ba26c1d8af', 'dashboard', 'developer', 3, 'Can edit', 'Share, plus change the dashboard card configuration.'),
  ('76f9f133-68d9-41ef-8ed1-a92c65c53135', 'dashboard', 'admin', 4, 'Full control', 'Developer, plus full control of the dashboard and its grants.'),
  ('d3128419-d42c-4783-b651-6d7f176cc813', 'context', 'view', 1, 'Can view', 'Open the draft and every published version, read-only.'),
  ('b867ada1-5e89-4675-8792-951b56d1695d', 'context', 'edit', 2, 'Can edit', 'Also change the draft: datasets, analysis, review and descriptions.'),
  ('80bb5d1c-7589-485f-b1cd-32fe6993d8b3', 'context', 'full', 3, 'Full access', 'Also delete the context and its published versions.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."roles" ("id", "company_id", "kind", "tier", "name", "description") VALUES
  ('b81ad886-d47f-4978-8bfd-e8c28d745c81', NULL, 'system', 'SUPER_ADMIN', 'Platform owner', 'Platform owner. Manages every company, user, role and dashboard assignment.'),
  ('301f455d-b2f0-4a7c-82db-66ed9fe2fd9d', NULL, 'system', 'COMPANY_ADMIN', 'Company admin', 'Administrator of one company. Manages that company’s users, groups and access.'),
  ('3f1c0146-ec04-43b6-85ba-6b27f7f60a28', NULL, 'system', 'USER', 'Member', 'Member of one company. Reaches only the resources explicitly granted to them.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "access_control"."role_permissions" ("role_id", "permission_ids") VALUES
  ('b81ad886-d47f-4978-8bfd-e8c28d745c81', ARRAY['25b11a0f-e42e-4e4d-aebf-06abb0ecf4c1', 'aabdaaf6-f03a-4d7c-96d9-1f6d3b069f13', 'ea9d9b78-9ca4-4eb9-8e7b-04fb780f05dd', '409c9b3d-a84c-440d-a7c5-994dbc9a6acb', '3a261a33-e359-47bd-acaa-65afddeae671', 'bbfea992-e3ee-42a9-a479-f0a828c182d4', '81c2a6a0-eb5c-41ba-83d4-53802c18d8af', 'edfd461e-eac9-4067-931e-a7dc7c22deaa', '674255bc-8a99-4b01-a143-df7ace6a65e6', '08e2331b-d946-4936-b254-44c61d399f9c', '699bfe3a-76bc-420b-a600-d9863dcab485', '8c379452-4769-4c84-a4be-12632b1e35d1', '1efce2a2-0576-443c-8f6a-5b6db4ef8c31', '6cf252de-9c65-4ecb-a044-2603cb57d0c4', 'de4cca58-2f64-4dbb-b97b-f3c00f20491d', '9876ed7d-4763-4b87-b9f9-8f2fa4c3c961', '59d59584-88f0-4dce-a964-842d86442060', 'f10b1f92-5763-4240-bd60-1802babe0527', 'f31de92f-9642-45bb-8e94-f76ee6b20e02', 'f2917a3f-9b07-4d0b-b6ad-3f4f364a6066', '77dfe7d4-1115-41a5-a16d-97069c98c48c', 'ee9b1bd0-f175-40f6-8b65-482b362f5893', '2a8414a4-e6d3-42a0-8e95-a6c2eeceea7e', '1e61c36d-a147-4c52-86c6-1efcad204558', 'f5c12def-b22b-4d63-b925-1865d353b7ce', '72eafd38-3ce0-4c7a-9838-131ae77cc35a', 'd8d7acf0-d7a0-45d5-834d-79bad948ff92', '5d52979f-2d66-4015-a3f7-dd766def2abb', 'ea4285b7-3a39-4b08-9b96-4d89cb2697f7', '347eb6ed-ea14-4c2b-a215-1d60dc52eaa0', 'dfbe89db-114d-4c38-9934-c12715407ceb', 'a31ef6fb-b600-4d10-bddc-aa8a90600ee4', '4f8a83ea-1d6e-41d9-a453-9907ea285121', 'dd73ca5f-92e3-480a-8cb5-7024229ec780', 'c83b79fd-2d9f-46ae-b12b-bc486a4b61aa', 'b1b68eaa-e599-4488-bd79-c17f02299321', '65e7d4f9-f9c5-46c4-a246-0c29ed378268', 'dea45e30-f930-477d-ab6f-93ca73ac6bbf', '842fd937-93c2-4789-9928-7f2cd8a74565', 'b1e815b5-561c-42b2-a9bc-6f58d5da64b9', '9f5246e9-bb69-4ad0-b7f5-c955a7f6827d', '2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8', 'b659cb7f-562c-4487-8fde-b51e5d269a91', '1e1e2e84-555d-477d-9bb9-86950d979681', '1a15c2b1-f63f-4013-9588-f8141649fdeb', '314cd364-c82a-40dc-8c3d-d12257181285', '232b52e5-81b8-4d37-86d6-f96e4361f4cf', '2e3129c4-6a5c-4abd-9629-84d09819beaf', 'b0171ac6-9d88-4c95-bb29-bb88a288baad']::uuid[]),
  ('301f455d-b2f0-4a7c-82db-66ed9fe2fd9d', ARRAY['25b11a0f-e42e-4e4d-aebf-06abb0ecf4c1', 'bbfea992-e3ee-42a9-a479-f0a828c182d4', '81c2a6a0-eb5c-41ba-83d4-53802c18d8af', 'edfd461e-eac9-4067-931e-a7dc7c22deaa', '674255bc-8a99-4b01-a143-df7ace6a65e6', '08e2331b-d946-4936-b254-44c61d399f9c', '699bfe3a-76bc-420b-a600-d9863dcab485', '8c379452-4769-4c84-a4be-12632b1e35d1', '6cf252de-9c65-4ecb-a044-2603cb57d0c4', 'de4cca58-2f64-4dbb-b97b-f3c00f20491d', '9876ed7d-4763-4b87-b9f9-8f2fa4c3c961', '59d59584-88f0-4dce-a964-842d86442060', 'f10b1f92-5763-4240-bd60-1802babe0527', 'f31de92f-9642-45bb-8e94-f76ee6b20e02', 'f2917a3f-9b07-4d0b-b6ad-3f4f364a6066', '77dfe7d4-1115-41a5-a16d-97069c98c48c', 'ee9b1bd0-f175-40f6-8b65-482b362f5893', '2a8414a4-e6d3-42a0-8e95-a6c2eeceea7e', '1e61c36d-a147-4c52-86c6-1efcad204558', 'f5c12def-b22b-4d63-b925-1865d353b7ce', '72eafd38-3ce0-4c7a-9838-131ae77cc35a', 'd8d7acf0-d7a0-45d5-834d-79bad948ff92', 'ea4285b7-3a39-4b08-9b96-4d89cb2697f7', '347eb6ed-ea14-4c2b-a215-1d60dc52eaa0', 'dfbe89db-114d-4c38-9934-c12715407ceb', 'a31ef6fb-b600-4d10-bddc-aa8a90600ee4', '4f8a83ea-1d6e-41d9-a453-9907ea285121', 'dd73ca5f-92e3-480a-8cb5-7024229ec780', 'c83b79fd-2d9f-46ae-b12b-bc486a4b61aa', 'b1b68eaa-e599-4488-bd79-c17f02299321', '65e7d4f9-f9c5-46c4-a246-0c29ed378268', 'dea45e30-f930-477d-ab6f-93ca73ac6bbf', '842fd937-93c2-4789-9928-7f2cd8a74565', 'b1e815b5-561c-42b2-a9bc-6f58d5da64b9', '9f5246e9-bb69-4ad0-b7f5-c955a7f6827d', '2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8', 'b659cb7f-562c-4487-8fde-b51e5d269a91', '1e1e2e84-555d-477d-9bb9-86950d979681', '1a15c2b1-f63f-4013-9588-f8141649fdeb', '314cd364-c82a-40dc-8c3d-d12257181285', '232b52e5-81b8-4d37-86d6-f96e4361f4cf', '2e3129c4-6a5c-4abd-9629-84d09819beaf', 'b0171ac6-9d88-4c95-bb29-bb88a288baad']::uuid[]),
  ('3f1c0146-ec04-43b6-85ba-6b27f7f60a28', ARRAY['1e61c36d-a147-4c52-86c6-1efcad204558', 'f5c12def-b22b-4d63-b925-1865d353b7ce', '72eafd38-3ce0-4c7a-9838-131ae77cc35a', 'ea4285b7-3a39-4b08-9b96-4d89cb2697f7', '347eb6ed-ea14-4c2b-a215-1d60dc52eaa0', 'b1b68eaa-e599-4488-bd79-c17f02299321', '65e7d4f9-f9c5-46c4-a246-0c29ed378268', 'dea45e30-f930-477d-ab6f-93ca73ac6bbf', '842fd937-93c2-4789-9928-7f2cd8a74565', '9f5246e9-bb69-4ad0-b7f5-c955a7f6827d', '2be8d1f6-60ba-4a9d-b44a-44446f3fd7d8', 'b659cb7f-562c-4487-8fde-b51e5d269a91', '1e1e2e84-555d-477d-9bb9-86950d979681', '314cd364-c82a-40dc-8c3d-d12257181285']::uuid[])
ON CONFLICT ("role_id") DO NOTHING;

INSERT INTO "public"."connectors" ("id", "name", "status", "description", "docs_url", "credentials", "sort_order") VALUES
  ('domo', 'Domo', 'available', 'Connect with a Domo access token and pick the datasets to build a context from.', 'https://domo-support.domo.com/s/article/360042934494', '[{"id":"name","label":"Connection name","type":"text","placeholder":"Sales","help":"How this connection appears in your workspace."},{"id":"host","label":"Domo instance","type":"text","placeholder":"acme.domo.com","help":"The address you sign in to. An access token is issued by one instance and is only valid there."},{"id":"token","label":"Developer access token","type":"secret","placeholder":"","help":"Domo → Admin → Authentication → Access tokens. Stored encrypted and never shown again."}]'::jsonb, 0),
  ('snowflake', 'Snowflake', 'planned', 'Account, warehouse, database and a key-pair or password credential.', NULL, '[]'::jsonb, 1),
  ('databricks', 'Databricks', 'planned', 'Workspace URL, SQL warehouse and a personal access token.', NULL, '[]'::jsonb, 2),
  ('bigquery', 'BigQuery', 'planned', 'Project, dataset and a service-account key.', NULL, '[]'::jsonb, 3),
  ('redshift', 'Amazon Redshift', 'planned', 'Cluster endpoint, database and credentials.', NULL, '[]'::jsonb, 4),
  ('postgres', 'PostgreSQL', 'planned', 'Host, database and a read-only role.', NULL, '[]'::jsonb, 5)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('login_success', 'login success', ARRAY['auth']::text[], NULL, 0),
  ('login_failed', 'login failed', ARRAY['auth']::text[], NULL, 1),
  ('login_blocked', 'login blocked', ARRAY['auth']::text[], NULL, 2),
  ('logout', 'logout', ARRAY['auth']::text[], NULL, 3),
  ('session_refreshed', 'session refreshed', ARRAY['auth']::text[], NULL, 4),
  ('session_revoked', 'session revoked', ARRAY['auth']::text[], 'delete', 5),
  ('refresh_reuse_detected', 'refresh reuse detected', ARRAY['auth']::text[], NULL, 6),
  ('password_changed', 'password changed', ARRAY['auth']::text[], 'update', 7),
  ('account_activated', 'account activated', ARRAY['auth']::text[], 'create', 8),
  ('company_created', 'company created', ARRAY['company', 'companies']::text[], 'create', 9),
  ('company_updated', 'company updated', ARRAY['company', 'companies']::text[], 'update', 10),
  ('company_deleted', 'company deleted', ARRAY['company', 'companies']::text[], 'delete', 11),
  ('company_features_updated', 'company features updated', ARRAY['company', 'companies']::text[], 'update', 12),
  ('user_created', 'user created', ARRAY['people']::text[], 'create', 13),
  ('user_updated', 'user updated', ARRAY['people']::text[], 'update', 14),
  ('user_deleted', 'user deleted', ARRAY['people']::text[], 'delete', 15),
  ('user_activated', 'user activated', ARRAY['people']::text[], 'create', 16),
  ('user_deactivated', 'user deactivated', ARRAY['people']::text[], 'delete', 17),
  ('user_activation_resent', 'user activation resent', ARRAY['people']::text[], 'update', 18),
  ('user_scope_updated', 'user scope updated', ARRAY['people']::text[], 'update', 19),
  ('user_permissions_updated', 'user permissions updated', ARRAY['people']::text[], 'update', 20),
  ('role_permissions_updated', 'role permissions updated', ARRAY['people']::text[], 'update', 21),
  ('role_created', 'role created', ARRAY['people']::text[], 'create', 22),
  ('role_updated', 'role updated', ARRAY['people']::text[], 'update', 23),
  ('role_deleted', 'role deleted', ARRAY['people']::text[], 'delete', 24),
  ('group_created', 'group created', ARRAY['people']::text[], 'create', 25),
  ('group_updated', 'group updated', ARRAY['people']::text[], 'update', 26),
  ('group_deleted', 'group deleted', ARRAY['people']::text[], 'delete', 27),
  ('dashboard_created', 'dashboard created', ARRAY['company', 'dashboards']::text[], 'create', 28),
  ('dashboard_assigned', 'dashboard assigned', ARRAY['company', 'dashboards']::text[], 'create', 29),
  ('dashboard_unassigned', 'dashboard unassigned', ARRAY['company', 'dashboards']::text[], 'delete', 30),
  ('dashboard_updated', 'dashboard updated', ARRAY['company', 'dashboards']::text[], 'update', 31),
  ('dashboard_deleted', 'dashboard deleted', ARRAY['company', 'dashboards']::text[], 'delete', 32),
  ('access_granted', 'access granted', ARRAY['company', 'dashboards']::text[], 'create', 33),
  ('access_revoked', 'access revoked', ARRAY['company', 'dashboards']::text[], 'delete', 34),
  ('access_denied', 'access denied', ARRAY['dashboards']::text[], NULL, 35),
  ('context_connection_created', 'Lakehouse connection created', ARRAY['company', 'lakehouse']::text[], 'create', 36),
  ('context_connection_deleted', 'Lakehouse connection deleted', ARRAY['company', 'lakehouse']::text[], 'delete', 37),
  ('context_version_created', 'Lakehouse version created', ARRAY['company', 'lakehouse']::text[], 'create', 38),
  ('context_profile_saved', 'context profile saved', ARRAY['company', 'lakehouse']::text[], NULL, 39),
  ('context_fact_updated', 'Lakehouse fact edited', ARRAY['company', 'lakehouse']::text[], 'update', 40),
  ('context_datasets_selected', 'Lakehouse datasets updated', ARRAY['company', 'lakehouse']::text[], 'update', 41),
  ('context_review_decided', 'Lakehouse fact reviewed', ARRAY['company', 'lakehouse']::text[], 'update', 42),
  ('context_published', 'Lakehouse context published', ARRAY['company', 'lakehouse']::text[], 'create', 43),
  ('context_version_deleted', 'Lakehouse version deleted', ARRAY['company', 'lakehouse']::text[], 'delete', 44),
  ('context_extraction_run', 'Lakehouse extraction run', ARRAY['company', 'lakehouse']::text[], NULL, 45),
  ('context_access_granted', 'Lakehouse context shared', ARRAY['company', 'lakehouse']::text[], 'create', 46),
  ('context_access_updated', 'Lakehouse sharing changed', ARRAY['company', 'lakehouse']::text[], 'update', 47),
  ('context_access_revoked', 'Lakehouse access removed', ARRAY['company', 'lakehouse']::text[], 'delete', 48)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_event_fkey" FOREIGN KEY ("event") REFERENCES "audit_event_types"("key") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_fkey" FOREIGN KEY ("provider") REFERENCES "connectors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE OR REPLACE FUNCTION "access_control"."grant_permission_to_platform_owner"() RETURNS trigger AS $$
BEGIN
  UPDATE "access_control"."role_permissions" rp
     SET permission_ids = array_append(rp.permission_ids, NEW.id), updated_at = now()
    FROM "access_control"."roles" r
   WHERE r.id = rp.role_id AND r.kind = 'system' AND r.tier = 'SUPER_ADMIN'
     AND NOT (NEW.id = ANY(rp.permission_ids));
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_permissions_platform_owner ON "access_control"."permissions";
CREATE TRIGGER trg_permissions_platform_owner AFTER INSERT ON "access_control"."permissions" FOR EACH ROW EXECUTE FUNCTION "access_control"."grant_permission_to_platform_owner"();

COMMENT ON TRIGGER trg_permissions_platform_owner ON "access_control"."permissions" IS 'The platform owner holds every permission: a new permission is added to the SUPER_ADMIN role as it is created.';

ALTER TABLE "access_control"."permissions" DROP COLUMN "defaults_applied_at";

DROP TABLE "rbac_repairs";
