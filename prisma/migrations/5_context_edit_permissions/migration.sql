UPDATE "access_control"."permissions"
   SET "description" = 'Connect a data warehouse to start a new context.'
 WHERE "key" = 'context.create';

UPDATE "access_control"."permissions"
   SET "description" = 'Choose datasets, run the AI analysis, edit and review facts, start a new version and share a context.'
 WHERE "key" = 'context.update';

UPDATE "access_control"."role_permissions" AS rp
   SET "permission_ids" = rp."permission_ids" || ARRAY(
         SELECT p."id" FROM "access_control"."permissions" p
          WHERE p."key" IN ('context.update', 'context.delete') AND p."id" <> ALL (rp."permission_ids"))
 WHERE EXISTS (SELECT 1 FROM "access_control"."permissions" p
                WHERE p."key" = 'context.read' AND p."id" = ANY (rp."permission_ids"))
   AND EXISTS (SELECT 1 FROM "access_control"."permissions" p
                WHERE p."key" IN ('context.update', 'context.delete') AND p."id" <> ALL (rp."permission_ids"));

UPDATE "access_control"."user_permissions" AS up
   SET "permission_ids" = up."permission_ids" || ARRAY(
         SELECT p."id" FROM "access_control"."permissions" p
          WHERE p."key" IN ('context.update', 'context.delete') AND p."id" <> ALL (up."permission_ids"))
 WHERE EXISTS (SELECT 1 FROM "access_control"."permissions" p
                WHERE p."key" = 'context.read' AND p."id" = ANY (up."permission_ids"))
   AND EXISTS (SELECT 1 FROM "access_control"."permissions" p
                WHERE p."key" IN ('context.update', 'context.delete') AND p."id" <> ALL (up."permission_ids"));
