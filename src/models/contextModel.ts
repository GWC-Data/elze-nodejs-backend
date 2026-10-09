import { quoteIdentifier } from '../tools/sql';
import { T } from './rbacModel';

const q = quoteIdentifier;

const CT = {
  connections: q('connections'),
  datasets: q('datasets'),
  reviews: q('context_object_reviews'),
  publications: q('context_publications'),
  versions: q('context_layer_versions'),
  objects: q('context_objects'),
  profiles: q('context_profiles'),
  access: q('context_access'),
};

const TABLES = [
  `CREATE TABLE IF NOT EXISTS ${CT.connections} (
     id               UUID         PRIMARY KEY,
     company_id       INTEGER      NOT NULL REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     provider         VARCHAR(32)  NOT NULL,
     name             VARCHAR(120) NOT NULL,
     host             VARCHAR(190) NOT NULL,
     secret           TEXT         NOT NULL,
     secret_hint      VARCHAR(24)  NOT NULL,
     status           VARCHAR(16)  NOT NULL DEFAULT 'connected',
     last_error       TEXT         NULL,
     last_verified_at TIMESTAMPTZ  NULL,
     created_by       INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
     CONSTRAINT uq_context_connections_name UNIQUE (company_id, provider, name)
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.datasets} (
     connection_id UUID         NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     dataset_id    VARCHAR(190) NOT NULL,
     name          VARCHAR(255) NULL,
     row_count     BIGINT       NULL,
     column_count  INTEGER      NULL,
     selected_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
     selected_by   INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     PRIMARY KEY (connection_id, dataset_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.reviews} (
     object_id     UUID        PRIMARY KEY,
     connection_id UUID        NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     status        VARCHAR(16) NOT NULL,
     note          TEXT        NULL,
     reviewed_by   INTEGER     NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
     CONSTRAINT chk_context_review_status
       CHECK (status IN ('pending','approved','rejected','skipped'))
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.publications} (
     id            UUID         PRIMARY KEY,
     connection_id UUID         NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     company_id    INTEGER      NOT NULL REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     name          VARCHAR(120) NOT NULL,
     version       INTEGER      NOT NULL,
     session_id    TEXT         NULL,
     object_count  INTEGER      NOT NULL DEFAULT 0,
     stats         JSONB        NOT NULL DEFAULT '{}'::jsonb,
     snapshot      JSONB        NOT NULL DEFAULT '[]'::jsonb,
     notify_team   BOOLEAN      NOT NULL DEFAULT FALSE,
     published_by  INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     published_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
     CONSTRAINT uq_context_publication_version UNIQUE (connection_id, name, version)
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.versions} (
     id                UUID         PRIMARY KEY,
     connection_id     UUID         NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     company_id        INTEGER      NOT NULL REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     name              VARCHAR(120) NOT NULL,
     version           INTEGER      NOT NULL,
     status            VARCHAR(16)  NOT NULL DEFAULT 'draft',
     current_step      VARCHAR(16)  NULL,
     dataset_ids       JSONB        NOT NULL DEFAULT '[]'::jsonb,
     based_on_id       UUID         NULL,
     session_id        TEXT         NULL,
     extraction_mode   VARCHAR(16)  NULL,
     extraction_report TEXT         NULL,
     extracted_at      TIMESTAMPTZ  NULL,
     object_count      INTEGER      NOT NULL DEFAULT 0,
     stats             JSONB        NOT NULL DEFAULT '{}'::jsonb,
     snapshot          JSONB        NOT NULL DEFAULT '[]'::jsonb,
     notify_team       BOOLEAN      NOT NULL DEFAULT FALSE,
     created_by        INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
     published_by      INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     published_at      TIMESTAMPTZ  NULL,
     CONSTRAINT chk_context_version_status CHECK (status IN ('draft','published')),
     CONSTRAINT chk_context_version_published
       CHECK (status <> 'published' OR published_at IS NOT NULL),
     CONSTRAINT uq_context_layer_version UNIQUE (connection_id, name, version)
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.profiles} (
     id            UUID         PRIMARY KEY,
     connection_id UUID         NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     company_id    INTEGER      NOT NULL REFERENCES ${T.companies} (id) ON DELETE CASCADE,
     name          VARCHAR(120) NOT NULL,
     description   TEXT         NULL,
     created_by    INTEGER      NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
     updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
     CONSTRAINT uq_context_profiles_connection UNIQUE (connection_id)
   )`,

  `CREATE TABLE IF NOT EXISTS ${CT.access} (
     connection_id UUID        NOT NULL REFERENCES ${CT.connections} (id) ON DELETE CASCADE,
     user_id       INTEGER     NOT NULL REFERENCES ${T.users} (id) ON DELETE CASCADE,
     access_level  VARCHAR(8)  NOT NULL,
     granted_by    INTEGER     NULL REFERENCES ${T.users} (id) ON DELETE SET NULL,
     granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (connection_id, user_id),
     CONSTRAINT chk_context_access_level CHECK (access_level IN ('view','edit','full'))
   )`,
];

const INDEXES = [
  `ALTER TABLE ${CT.reviews} ADD COLUMN IF NOT EXISTS edited BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE ${CT.versions} ADD COLUMN IF NOT EXISTS datasets JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE ${CT.versions} DROP CONSTRAINT IF EXISTS context_layer_versions_based_on_id_fkey`,
  `ALTER TABLE ${CT.versions} ADD COLUMN IF NOT EXISTS extraction_dataset_ids JSONB NULL`,
  `ALTER TABLE ${CT.connections} ADD COLUMN IF NOT EXISTS general_access VARCHAR(16) NOT NULL DEFAULT 'company'
     CONSTRAINT chk_context_connections_general_access CHECK (general_access IN ('restricted','company'))`,
  `CREATE INDEX IF NOT EXISTS idx_context_access_user ON ${CT.access} (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_connections_company ON ${CT.connections} (company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_object_reviews_connection
     ON ${CT.reviews} (connection_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_publications_connection
     ON ${CT.publications} (connection_id, published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_publications_company
     ON ${CT.publications} (company_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_context_layer_one_draft
     ON ${CT.versions} (connection_id) WHERE status = 'draft'`,
  `CREATE INDEX IF NOT EXISTS idx_context_layer_versions_connection
     ON ${CT.versions} (connection_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_context_layer_versions_company
     ON ${CT.versions} (company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_profiles_company
     ON ${CT.profiles} (company_id)`,
];

const BACKFILL = `
  INSERT INTO ${CT.versions}
    (id, connection_id, company_id, name, version, status, current_step, session_id,
     object_count, stats, snapshot, notify_team, created_by, created_at, updated_at,
     published_by, published_at)
  SELECT id, connection_id, company_id, name, version, 'published', 'publish', session_id,
         object_count, stats, snapshot, notify_team, published_by, published_at, published_at,
         published_by, published_at
    FROM ${CT.publications}
  ON CONFLICT DO NOTHING`;

export { CT, TABLES, INDEXES, BACKFILL };
