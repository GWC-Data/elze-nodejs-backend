INSERT INTO "access_control"."permissions" ("id", "key", "label", "description", "feature_id", "platform_only", "admin_only", "sort_order")
SELECT '76ea04b2-3679-4610-b89d-6de07fd7496c', 'audit.read', 'View Audit Log',
       'See the audit log of everyone in scope: the whole company, or every company for a platform account. Without it, only your own activity.', NULL, FALSE, FALSE,
       COALESCE(MAX("sort_order"), 0) + 1
  FROM "access_control"."permissions"
ON CONFLICT ("id") DO NOTHING;

UPDATE "access_control"."role_permissions"
   SET "permission_ids" = "permission_ids" || ARRAY['76ea04b2-3679-4610-b89d-6de07fd7496c']::uuid[], "updated_at" = now()
 WHERE "role_id" IN ('b81ad886-d47f-4978-8bfd-e8c28d745c81', '6686f739-2e9f-4c62-8df3-eeaf69e85b5e', '301f455d-b2f0-4a7c-82db-66ed9fe2fd9d')
   AND NOT ('76ea04b2-3679-4610-b89d-6de07fd7496c'::uuid = ANY ("permission_ids"));
