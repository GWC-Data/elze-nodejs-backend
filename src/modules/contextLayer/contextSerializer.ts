import { REVIEW_STATUS } from '../../shared/db/statuses';
import type { FactRow } from './contextRepository';
import { field } from './contextTypes';
import type { JsonValue } from './contextTypes';

interface Fact {
  id: string;
  objectType: string;
  qualifiedName: string;
  sourceType: string;
  verified: boolean;
  confidence: number | null;
  status: string;
  edited: boolean;
  payload: JsonValue;
}

interface ReviewItem {
  id: string;
  type: string;
  name: string;
  status: string;
  confidence: number | null;
  description: string | null;
  formula: string | null;
  source: string;
  downstreamImpact: string | null;
  fields: JsonValue;
}

interface ContextObjectItem {
  id: string;
  objectType: string;
  qualifiedName: string;
  sourceType: string;
  verified: boolean;
  payload: JsonValue;
}

interface SnapshotEntry {
  id: string;
  objectType: string;
  qualifiedName: string;
  sourceType: string;
  confidence: number | null;
  payload: JsonValue;
  edited: boolean;
}

function textOrNull(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function reviewStatusOf(row: Pick<FactRow, 'review_status' | 'verified'>): string {
  if (row.review_status) return row.review_status;
  return row.verified ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.PENDING;
}

function shapeFact(row: FactRow): Fact {
  return {
    id: row.id,
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    sourceType: row.source_type,
    verified: row.verified,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    status: reviewStatusOf(row),
    edited: Boolean(row.review_edited),
    payload: row.payload || {},
  };
}

function shapeReviewItem(row: FactRow): ReviewItem {
  const payload = row.payload || {};
  return {
    id: row.id,
    type: row.object_type,
    name: row.qualified_name,
    status: reviewStatusOf(row),
    confidence: row.confidence === null ? null : Number(row.confidence),
    description: textOrNull(field(payload, 'description')),
    formula: textOrNull(field(payload, 'formula')),
    source: row.source_type,
    downstreamImpact: textOrNull(field(payload, 'note')),
    fields: payload,
  };
}

function contextObjectItem(row: FactRow): ContextObjectItem {
  return {
    id: row.id,
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    sourceType: row.source_type,
    verified: row.verified,
    payload: row.payload,
  };
}

function snapshotEntry(row: FactRow): SnapshotEntry {
  return {
    id: row.id,
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    sourceType: row.source_type,
    confidence: row.confidence === null ? null : Number(row.confidence),
    payload: row.payload,
    edited: Boolean(row.review_edited),
  };
}

export { reviewStatusOf, shapeFact, shapeReviewItem, contextObjectItem, snapshotEntry };
export type { Fact, ReviewItem, ContextObjectItem, SnapshotEntry };
