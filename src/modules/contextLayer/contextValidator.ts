import { fail } from '../../shared/errors/AppError';
import { entry, listOf } from './contextTypes';
import type { RequestBody } from './contextTypes';

const MAX_DATASET_LIMIT = 500;

interface DatasetSelection {
  id: string;
  name: string | null;
  rowCount: number | null;
  columnCount: number | null;
}

interface ExtractionRecord {
  sessionId: string | null;
  extractionReport: string;
  extractionDatasetIds: string[];
}

function readLimit(raw: unknown): number | undefined {
  if (raw === undefined || raw === '') return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_DATASET_LIMIT) {
    throw fail('VALIDATION_ERROR', `limit must be a whole number between 1 and ${MAX_DATASET_LIMIT} (got "${raw}").`);
  }
  return value;
}

function cleanDatasetSelection(datasets: unknown): DatasetSelection[] {
  const entries = listOf(datasets);
  if (!entries) {
    throw fail('VALIDATION_ERROR', 'Expected a list of datasets.');
  }

  const clean: DatasetSelection[] = [];
  const seen = new Set<string>();
  for (const item of entries) {
    const source = typeof item === 'string' ? { id: item } : item || {};
    const name = entry(source, 'name');
    const rowCount = entry(source, 'rowCount');
    const columnCount = entry(source, 'columnCount');
    const datasetId = String(entry(source, 'id') || '').trim();
    if (!datasetId) continue;
    if (datasetId.length > 190) {
      throw fail('VALIDATION_ERROR', 'A dataset id is longer than this connector allows.');
    }
    if (seen.has(datasetId)) continue;
    seen.add(datasetId);
    clean.push({
      id: datasetId,
      name: name ? String(name).slice(0, 255) : null,
      rowCount: Number.isFinite(Number(rowCount)) ? Number(rowCount) : null,
      columnCount: Number.isFinite(Number(columnCount)) ? Number(columnCount) : null,
    });
  }
  return clean;
}

function extractionRecord(body: RequestBody = {}): ExtractionRecord {
  const report = typeof body.report === 'string' ? body.report.slice(0, 200000) : '';
  if (!report.trim()) throw fail('VALIDATION_ERROR', 'report is required.');
  const datasetIds = listOf(body.datasetIds);
  return {
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 200) : null,
    extractionReport: report,
    extractionDatasetIds: datasetIds ? datasetIds.map(String).slice(0, 500) : [],
  };
}

export { readLimit, cleanDatasetSelection, extractionRecord };
export type { DatasetSelection, ExtractionRecord };
