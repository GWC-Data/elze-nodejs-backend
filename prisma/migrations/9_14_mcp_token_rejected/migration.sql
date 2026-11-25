INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('mcp_token_rejected', 'MCP token rejected', ARRAY['auth']::text[], NULL, 62)
ON CONFLICT ("key") DO NOTHING;
