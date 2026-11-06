import { ENVELOPE_KEYS, SUMMARY_MAX } from './auditEvents';
import { auditEventLabel } from '../catalogue/catalogueService';
import { formatFields, NO_NAMES } from './auditFormatter';
import type { AuditField, AuditNames } from './auditFormatter';

type AuditEntry = Record<string, unknown>;

interface AuditRowMeta {
  id?: number | string | null;
  companyId?: string | null;
  companyName?: string | null;
}

interface AuditItem {
  id?: string;
  ts: unknown;
  event: unknown;
  label: string;
  tone: string;
  summary: string;
  fields: AuditField[];
  detail: Record<string, unknown>;
  actor?: unknown;
  actorId?: unknown;
  actorCompanyId?: unknown;
  companyId?: string;
  companyName?: string;
}

function toneFor(event: unknown): string {
  const name = String(event).toLowerCase();
  if (name.includes('denied') || name.includes('fail') || name.includes('block')) return 'danger';
  if (name.includes('deleted') || name.includes('revoked') || name.includes('deactivated')) return 'warning';
  if (name.includes('created') || name.includes('granted') || name.includes('activated') || name.includes('restored'))
    return 'success';
  return 'neutral';
}

function shapeEntry(entry: AuditEntry, meta: AuditRowMeta = {}, names: AuditNames = NO_NAMES): AuditItem {
  const detail: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (ENVELOPE_KEYS.has(key) || value === null || value === undefined) continue;
    detail[key] = value;
  }
  const fields = formatFields(detail, names);
  const summary = fields.map((field) => `${field.label}: ${field.value}`).join(' · ');
  const item: AuditItem = {
    ts: entry.ts,
    event: entry.event,
    label: (auditEventLabel(String(entry.event || '')) ?? String(entry.event || '').replace(/_/g, ' ')).toLowerCase(),
    tone: toneFor(entry.event || ''),
    summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
    fields,
    detail,
  };
  if (meta.id !== null && meta.id !== undefined) item.id = String(meta.id);
  if (entry.actor !== null && entry.actor !== undefined) item.actor = entry.actor;
  if (entry.actorId !== null && entry.actorId !== undefined) item.actorId = entry.actorId;
  if (entry.actorCompanyId !== null && entry.actorCompanyId !== undefined) {
    item.actorCompanyId = entry.actorCompanyId;
  }
  if (meta.companyId !== null && meta.companyId !== undefined) item.companyId = meta.companyId;
  if (meta.companyName) item.companyName = meta.companyName;
  return item;
}

export { shapeEntry };
export type { AuditItem };
