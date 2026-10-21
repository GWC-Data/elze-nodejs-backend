INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('password_reset_requested', 'password reset requested', ARRAY['auth']::text[], NULL, 49),
  ('password_reset', 'password reset', ARRAY['auth']::text[], 'update', 50)
ON CONFLICT ("key") DO NOTHING;
