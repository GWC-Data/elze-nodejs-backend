import { fail } from '../../shared/errors/AppError';
import { isUuid } from '../../shared/validation/commonValidator';

const MCP_DATA_LIMITS = {
  defaultLimit: 25,
  maxLimit: 100,
  search: 200,
  words: 8,
  contextName: 120,
  qualifiedName: 500,
} as const;

const OBJECT_TYPES = [
  'table',
  'column_stats',
  'join',
  'transformation',
  'glossary',
  'metric',
  'example',
  'constraint',
] as const;

const CONTEXT_NOT_FOUND = 'Context not found.';

interface PageWindow {
  offset: number;
  limit: number;
}

interface ContextKey {
  connectionId: string;
  name: string;
}

interface EntryFilter {
  types: readonly string[] | null;
  qualifiedName: string | null;
  words: readonly string[];
}

function single(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw fail('VALIDATION_ERROR', `Send ${label} once, as plain text.`);
  return value;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): number {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const offset = typeof parsed === 'object' && parsed !== null && 'o' in parsed ? parsed.o : undefined;
    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    throw fail('VALIDATION_ERROR', 'cursor is not one this API issued.');
  }
  throw fail('VALIDATION_ERROR', 'cursor is not one this API issued.');
}

function pageWindow(query: Record<string, unknown>): PageWindow {
  const rawLimit = single(query.limit, 'limit');
  const rawCursor = single(query.cursor, 'cursor');
  let limit: number = MCP_DATA_LIMITS.defaultLimit;
  if (rawLimit !== undefined && rawLimit !== '') {
    limit = /^\d+$/.test(rawLimit) ? Number(rawLimit) : Number.NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MCP_DATA_LIMITS.maxLimit) {
      throw fail('VALIDATION_ERROR', `limit must be a whole number from 1 to ${MCP_DATA_LIMITS.maxLimit}.`);
    }
  }
  const offset = rawCursor === undefined || rawCursor === '' ? 0 : decodeCursor(rawCursor);
  return { offset, limit };
}

function nextCursor(window: PageWindow, total: number): string | null {
  const next = window.offset + window.limit;
  return next < total ? encodeCursor(next) : null;
}

function versionOf(value: unknown): number | null {
  const raw = single(value, 'version');
  if (raw === undefined || raw === '') return null;
  const version = /^v?\d+$/i.test(raw) ? Number(raw.replace(/^v/i, '')) : Number.NaN;
  if (!Number.isInteger(version) || version < 1) {
    throw fail('VALIDATION_ERROR', 'version must be a published version number, such as 3 or v3.');
  }
  return version;
}

function searchTextOf(value: unknown): string {
  return (single(value, 'q') ?? '').trim().slice(0, MCP_DATA_LIMITS.search);
}

function searchWordsOf(value: unknown): string[] {
  const words = searchTextOf(value).split(/\s+/).filter(Boolean);
  return [...new Set(words.map((w) => w.toLowerCase()))].slice(0, MCP_DATA_LIMITS.words);
}

function objectTypesOf(value: unknown): string[] | null {
  const raw = single(value, 'type');
  if (raw === undefined || raw.trim() === '') return null;
  const types = [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  ];
  const known: readonly string[] = OBJECT_TYPES;
  const unknown = types.filter((t) => !known.includes(t));
  if (unknown.length) {
    throw fail('VALIDATION_ERROR', `Unknown type "${unknown[0]}". Use one or more of: ${OBJECT_TYPES.join(', ')}.`);
  }
  return types;
}

function qualifiedNameOf(value: unknown, required: boolean): string | null {
  const raw = (single(value, 'qualifiedName') ?? '').trim();
  if (!raw) {
    if (required) throw fail('VALIDATION_ERROR', 'qualifiedName is required.');
    return null;
  }
  if (raw.length > MCP_DATA_LIMITS.qualifiedName) {
    throw fail('VALIDATION_ERROR', `qualifiedName must be ${MCP_DATA_LIMITS.qualifiedName} characters or fewer.`);
  }
  return raw;
}

function entryFilterOf(query: Record<string, unknown>): EntryFilter {
  return {
    types: objectTypesOf(query.type),
    qualifiedName: qualifiedNameOf(query.qualifiedName, false),
    words: searchWordsOf(query.q),
  };
}

function contextKeyOf(params: Record<string, unknown>): ContextKey {
  const connectionId = params.connectionId;
  const name = typeof params.name === 'string' ? params.name : '';
  if (!isUuid(connectionId) || !name || name.length > MCP_DATA_LIMITS.contextName) {
    throw fail('RESOURCE_NOT_FOUND', CONTEXT_NOT_FOUND);
  }
  return { connectionId: connectionId.toLowerCase(), name };
}

export {
  MCP_DATA_LIMITS,
  OBJECT_TYPES,
  CONTEXT_NOT_FOUND,
  encodeCursor,
  decodeCursor,
  pageWindow,
  nextCursor,
  versionOf,
  searchTextOf,
  searchWordsOf,
  objectTypesOf,
  qualifiedNameOf,
  entryFilterOf,
  contextKeyOf,
};
export type { PageWindow, ContextKey, EntryFilter };
