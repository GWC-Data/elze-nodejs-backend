INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('company_restored', 'company restored', ARRAY['company', 'companies']::text[], 'update', 51),
  ('user_restored', 'user restored', ARRAY['people']::text[], 'update', 52),
  ('role_restored', 'role restored', ARRAY['people']::text[], 'update', 53),
  ('group_restored', 'group restored', ARRAY['people']::text[], 'update', 54),
  ('context_connection_restored', 'Lakehouse connection restored', ARRAY['company', 'lakehouse']::text[], 'update', 55),
  ('context_version_restored', 'Lakehouse version restored', ARRAY['company', 'lakehouse']::text[], 'update', 56)
ON CONFLICT ("key") DO NOTHING;
