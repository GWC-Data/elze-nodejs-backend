CREATE TABLE "access_control"."scope_dimensions" (
    "dimension" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120),
    "source_schema" VARCHAR(63),
    "source_table" VARCHAR(63) NOT NULL,
    "source_column" VARCHAR(63) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_dimensions_pkey" PRIMARY KEY ("dimension"),
    CONSTRAINT "chk_scope_dimensions_key" CHECK ("dimension" ~ '^[a-z0-9_]{1,64}$')
);

COMMENT ON TABLE "access_control"."scope_dimensions" IS 'Columns a user''s row-level data scope may be set on. One row per dimension; the selectable values are read from the column with SELECT DISTINCT.';
COMMENT ON COLUMN "access_control"."scope_dimensions"."dimension" IS 'Key stored in user_data_scopes.scopes, e.g. theater.';
COMMENT ON COLUMN "access_control"."scope_dimensions"."label" IS 'Name shown to people. NULL = the key.';
COMMENT ON COLUMN "access_control"."scope_dimensions"."source_schema" IS 'Schema of the reporting table. NULL = the search path.';
COMMENT ON COLUMN "access_control"."scope_dimensions"."source_table" IS 'Reporting table the values come from, e.g. cinema_analysis.';
COMMENT ON COLUMN "access_control"."scope_dimensions"."source_column" IS 'Column the values come from, e.g. Theater Name.';
