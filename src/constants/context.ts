const AI_TEXT_KEYS = new Set(['description', 'note', 'logic_summary', 'definition', 'basis']);

const GENERIC_COLUMNS = new Set([
  'id', 'name', 'description', 'status', 'type', 'title', 'notes', 'comment', 'comments',
  'created_at', 'updated_at', 'created_date', 'updated_date', 'created', 'updated',
  'modified', 'modified_at', 'last_modified', 'last_updated', 'date', 'timestamp',
  'created_by', 'updated_by', 'modified_by', 'is_active', 'active', 'deleted',
]);

const TERM_TYPES: Record<string, string> = {
  table: 'entity',
  metric: 'metric',
  glossary: 'term',
};

const TYPE_LABELS: Record<string, string> = { entity: 'Entity', metric: 'Metric', dimension: 'Dimension', term: 'Term' };

const TERM_ORDER: Record<string, number> = { entity: 0, metric: 1, dimension: 2, term: 3 };

const CONFIDENT = 0.8;

const GLOSSARY_FILTERS: Record<string, string[] | null> = {
  all: null,
  ai: ['ai_generated'],
  review: ['ai_suggested'],
  approved: ['human_approved', 'source_verified'],
  override: ['human_override'],
};

const MCP_TOOLS = [
  { name: 'list_context_objects', description: 'List the facts recorded for this connection, filterable by type.' },
  { name: 'get_context_object', description: 'Read one fact by id or qualified name.' },
  { name: 'search_context_objects', description: 'Semantic search over the facts (pgvector).' },
  { name: 'query_sql', description: 'Read-only SELECT / WITH over the context store, row-level scoped to the workspace.' },
];

const CONTEXT_ACCESS_LEVELS = ['view', 'edit', 'full'] as const;
type ContextAccessLevel = (typeof CONTEXT_ACCESS_LEVELS)[number];
const CONTEXT_LEVEL_RANK: Record<ContextAccessLevel, number> = { view: 1, edit: 2, full: 3 };

const GENERAL_ACCESS = ['restricted', 'company'] as const;
type GeneralAccess = (typeof GENERAL_ACCESS)[number];

export {
  AI_TEXT_KEYS,
  GENERIC_COLUMNS,
  TERM_TYPES,
  TYPE_LABELS,
  TERM_ORDER,
  CONFIDENT,
  GLOSSARY_FILTERS,
  MCP_TOOLS,
  CONTEXT_ACCESS_LEVELS,
  CONTEXT_LEVEL_RANK,
  GENERAL_ACCESS,
};
export type { ContextAccessLevel, GeneralAccess };
