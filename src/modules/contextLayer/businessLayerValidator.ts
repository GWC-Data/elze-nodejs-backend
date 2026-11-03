import { fail } from '../../shared/errors/AppError';
import { entry, isJsonObject } from './contextTypes';

const LIMITS = {
  tables: 500,
  tableId: 190,
  tableOverview: 2000,
} as const;

type Mode = 'strict' | 'lenient';

interface BusinessLayer {
  tables: Record<string, string>;
}

function text(value: unknown, max: number, label: string, mode: Mode): string {
  const raw = typeof value === 'string' ? value : '';
  if (raw.length <= max) return raw;
  if (mode === 'strict') throw fail('VALIDATION_ERROR', `${label} must be ${max} characters or fewer.`);
  return raw.slice(0, max);
}

function tables(value: unknown, mode: Mode): Record<string, string> {
  const source = isJsonObject(value) ? Object.entries(value) : [];
  if (source.length > LIMITS.tables && mode === 'strict') {
    throw fail('VALIDATION_ERROR', `Up to ${LIMITS.tables} dataset overviews can be saved.`);
  }
  const clean: Record<string, string> = {};
  for (const [rawId, overview] of source.slice(0, LIMITS.tables)) {
    const tableId = rawId.trim();
    if (!tableId) continue;
    if (tableId.length > LIMITS.tableId) {
      if (mode === 'strict') throw fail('VALIDATION_ERROR', 'A dataset id is longer than this connector allows.');
      continue;
    }
    const written = text(overview, LIMITS.tableOverview, 'A dataset overview', mode);
    if (written.trim()) clean[tableId] = written;
  }
  return clean;
}

function businessLayerOf(value: unknown, mode: Mode): BusinessLayer {
  return { tables: tables(entry(value, 'tables'), mode) };
}

function cleanBusinessLayer(body: unknown): BusinessLayer {
  if (!isJsonObject(body)) throw fail('VALIDATION_ERROR', 'Expected the business layer as an object.');
  return businessLayerOf(body, 'strict');
}

function readBusinessLayer(stored: unknown): BusinessLayer {
  return businessLayerOf(stored, 'lenient');
}

export { cleanBusinessLayer, readBusinessLayer, LIMITS as BUSINESS_LAYER_LIMITS };
export type { BusinessLayer };
