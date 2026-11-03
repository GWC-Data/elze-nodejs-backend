const AI_TEXT_KEYS = new Set(['description', 'note', 'logic_summary', 'definition', 'basis']);

const TERM_TYPES: Record<string, string> = {
  table: 'entity',
  metric: 'metric',
  glossary: 'term',
};

const TYPE_LABELS: Record<string, string> = {
  entity: 'Entity',
  metric: 'Metric',
  dimension: 'Dimension',
  term: 'Term',
};

const TERM_ORDER: Record<string, number> = { entity: 0, metric: 1, dimension: 2, term: 3 };

const CONFIDENT = 0.8;

const HIGH_CONFIDENCE = 0.9;

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
  {
    name: 'query_sql',
    description: 'Read-only SELECT / WITH over the context store, row-level scoped to the workspace.',
  },
];

type ContextAccessLevel = 'view' | 'edit' | 'full';

const GENERAL_ACCESS = ['restricted', 'company'] as const;
type GeneralAccess = (typeof GENERAL_ACCESS)[number];

export {
  AI_TEXT_KEYS,
  TERM_TYPES,
  TYPE_LABELS,
  TERM_ORDER,
  CONFIDENT,
  HIGH_CONFIDENCE,
  GLOSSARY_FILTERS,
  MCP_TOOLS,
  GENERAL_ACCESS,
};
export type { ContextAccessLevel, GeneralAccess };
