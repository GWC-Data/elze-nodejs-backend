import { ENVELOPE_KEYS, SUMMARY_MAX } from './auditEvents';
import { auditEventLabel } from '../catalogue/catalogueService';

type AuditEntry = Record<string, unknown>;

interface AuditRowMeta {
  id?: number | string | null;
  companyId?: number | null;
  companyName?: string | null;
}

interface AuditItem {
  id?: string;
  ts: unknown;
  event: unknown;
  label: string;
  tone: string;
  summary: string;
  detail: Record<string, unknown>;
  actor?: unknown;
  actorId?: unknown;
  actorCompanyId?: unknown;
  companyId?: number;
  companyName?: string;
}

function toneFor(event: unknown): string {
  const name = String(event).toLowerCase();
  if (name.includes('denied') || name.includes('fail') || name.includes('block')) return 'danger';
  if (name.includes('deleted') || name.includes('revoked') || name.includes('deactivated')) return 'warning';
  if (name.includes('created') || name.includes('granted') || name.includes('activated')) return 'success';
  return 'neutral';
}

function shapeEntry(entry: AuditEntry, meta: AuditRowMeta = {}): AuditItem {
  const detail: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    if (ENVELOPE_KEYS.has(key) || value === null || value === undefined) continue;
    detail[key] = value;
    parts.push(`${key}: ${String(value)}`);
  }
  const summary = parts.join(' · ');
  const item: AuditItem = {
    ts: entry.ts,
    event: entry.event,
    label: (auditEventLabel(String(entry.event || '')) ?? String(entry.event || '').replace(/_/g, ' ')).toLowerCase(),
    tone: toneFor(entry.event || ''),
    summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
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
