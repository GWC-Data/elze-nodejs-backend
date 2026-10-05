import { REVIEW_STATUS } from '../../constants/statuses';

type Row = Record<string, any>;

function reviewStatusOf(row: Row): string {
  if (row.review_status) return row.review_status;
  return row.verified ? REVIEW_STATUS.APPROVED : REVIEW_STATUS.PENDING;
}

function shapeFact(row: Row) {
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

function shapeReviewItem(row: Row) {
  const payload = row.payload || {};
  return {
    id: row.id,
    type: row.object_type,
    name: row.qualified_name,
    status: reviewStatusOf(row),
    confidence: row.confidence === null ? null : Number(row.confidence),
    description: typeof payload.description === 'string' ? payload.description : null,
    formula: typeof payload.formula === 'string' ? payload.formula : null,
    source: row.source_type,
    downstreamImpact: typeof payload.note === 'string' ? payload.note : null,
    fields: payload,
  };
}

function contextObjectItem(row: Row) {
  return {
    id: row.id,
    objectType: row.object_type,
    qualifiedName: row.qualified_name,
    sourceType: row.source_type,
    verified: row.verified,
    payload: row.payload,
  };
}

function snapshotEntry(row: Row) {
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
