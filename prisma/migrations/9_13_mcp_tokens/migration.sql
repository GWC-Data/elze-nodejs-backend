-- CreateTable
CREATE TABLE "mcp_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "token_prefix" VARCHAR(16) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "scope" VARCHAR(32) NOT NULL DEFAULT 'mcp:read',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,
    "revoked_reason" VARCHAR(40),

    CONSTRAINT "mcp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_mcp_tokens_hash" ON "mcp_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_mcp_tokens_user" ON "mcp_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

INSERT INTO "public"."audit_event_types" ("key", "label", "categories", "action", "sort_order") VALUES
  ('mcp_token_created', 'MCP token created', ARRAY['auth']::text[], 'create', 60),
  ('mcp_token_revoked', 'MCP token revoked', ARRAY['auth']::text[], 'delete', 61)
ON CONFLICT ("key") DO NOTHING;
