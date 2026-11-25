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
  { name: 'list_contexts', description: 'The published contexts you can read (on the all-contexts URL).' },
  { name: 'get_context_overview', description: 'Datasets, fact counts and the business overview of a context.' },
  { name: 'list_versions', description: 'The published versions of a context; the newest is live.' },
  { name: 'list_tables', description: 'Every table in the context with its short description.' },
  { name: 'describe_table', description: 'One table: columns and statistics, relationships, business overview.' },
  { name: 'search_context', description: 'Keyword search over every approved fact in the context.' },
  { name: 'list_metrics', description: 'The metric definitions of the context.' },
  { name: 'get_metric', description: 'One metric by name, with its definition and logic.' },
  { name: 'lookup_glossary', description: 'Business terms and what they mean in this context.' },
  { name: 'list_relationships', description: 'How the tables join to each other.' },
  { name: 'list_examples', description: 'Example queries and cards recorded for the context.' },
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
