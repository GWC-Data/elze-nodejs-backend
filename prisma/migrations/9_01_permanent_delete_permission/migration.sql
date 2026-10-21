INSERT INTO "access_control"."permissions" ("id", "key", "label", "description", "feature_id", "platform_only", "admin_only", "sort_order")
SELECT '723b3e13-f73b-41da-a703-472987c01eb3', 'delete.permanent', 'Delete Permanently',
       'Remove a record from the database for good instead of keeping it as deleted.', NULL, FALSE, TRUE,
       COALESCE(MAX("sort_order"), 0) + 1
  FROM "access_control"."permissions"
ON CONFLICT ("id") DO NOTHING;

UPDATE "access_control"."role_permissions"
   SET "permission_ids" = "permission_ids" || ARRAY['723b3e13-f73b-41da-a703-472987c01eb3']::uuid[], "updated_at" = now()
 WHERE "role_id" = '301f455d-b2f0-4a7c-82db-66ed9fe2fd9d'
   AND NOT ('723b3e13-f73b-41da-a703-472987c01eb3'::uuid = ANY ("permission_ids"));
