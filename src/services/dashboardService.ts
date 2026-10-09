import crypto from 'crypto';
import path from 'path';
import config from '../config';
import * as dashboardRepository from '../repositories/dashboardRepository';
import * as accessRepository from '../repositories/accessRepository';
import * as queryRepository from '../repositories/queryRepository';
import { fail, DashboardNotFoundError } from '../tools/AppError';
import { dashboardSlugify } from '../tools/slugify';
import { assertValidDashboardId } from '../validators/dashboardValidator';
import { requireString } from '../validators/commonValidator';
import { normalizeSpec, flattenCard, cardKind } from '../models/cardModel';
import { columnCatalogue, hydratedView } from '../views/serializers/dashboardSerializer';
import { hydrateDashboard } from './queryEngineService';
import { resolveSourceMetadata } from './metadataService';
import { audit, EVENTS } from './auditService';
import {
  DASHBOARD_ID_RE,
  NEW_DASHBOARD_VERSION,
  DEFAULT_DATA_SOURCE,
  DEFAULT_LAYOUT,
} from '../constants/dashboard';
import type { Actor } from '../types/actor';

const { DEFAULT_DASHBOARD_ID } = config.engine;

type Spec = Record<string, any>;
type DashboardEntry = Record<string, any>;

const { DASHBOARD_DIR, DEFAULT_SPEC_PATH } = dashboardRepository;

const specCache = new Map<string, Spec>();
const diskTitleCache = new Map<string, { mtimeMs: any; title: any }>();

function readSpecFile(filePath: string): Spec {
  const spec = dashboardRepository.readJsonFile(filePath);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error(`Dashboard file ${path.basename(filePath)} does not contain a dashboard object`);
  }
  return normalizeSpec(spec);
}

function defaultSpecId(): string | null {
  if (!dashboardRepository.fileExists(DEFAULT_SPEC_PATH)) return null;
  try {
    const spec = readSpecFile(DEFAULT_SPEC_PATH);
    return typeof spec.id === 'string' && spec.id.trim() ? spec.id.trim() : null;
  } catch (_) {
    return null;
  }
}

function registryPathFor(dashboardId: unknown): string {
  return dashboardRepository.specFilePath(assertValidDashboardId(dashboardId));
}

function specPathFor(dashboardId: unknown): string | null {
  const id = assertValidDashboardId(dashboardId);
  const registryPath = registryPathFor(id);
  if (dashboardRepository.fileExists(registryPath)) return registryPath;
  if (dashboardRepository.fileExists(DEFAULT_SPEC_PATH) && (id === DEFAULT_DASHBOARD_ID || id === defaultSpecId())) {
    return DEFAULT_SPEC_PATH;
  }
  return null;
}

async function getSpec(dashboardId: unknown): Promise<Spec> {
  const id = assertValidDashboardId(dashboardId);
  const cached = specCache.get(id);
  if (cached) return cached;

  try {
    const row = await dashboardRepository.findById(id);
    if (row) {
      let spec = row.spec;
      if (typeof spec === 'string') spec = JSON.parse(spec);
      spec = normalizeSpec(spec);
      if (!spec.id) spec.id = row.id;
      if (!spec.title && row.title) spec.title = row.title;
      if (!spec.description && row.description) spec.description = row.description;
      spec.companyId = row.company_id;
      specCache.set(id, spec);
      return spec;
    }
  } catch (_) {}

  const filePath = specPathFor(id);
  if (filePath) {
    const spec = readSpecFile(filePath);
    specCache.set(id, spec);
    return spec;
  }

  throw new DashboardNotFoundError(id);
}

function diskTitle(filePath: string): any {
  let mtimeMs: any;
  try {
    mtimeMs = dashboardRepository.fileMtime(filePath);
  } catch (_) {
    diskTitleCache.delete(filePath);
    return undefined;
  }
  const cached = diskTitleCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.title;
  let title: any;
  try {
    title = readSpecFile(filePath).title;
  } catch (_) {
    title = undefined;
  }
  diskTitleCache.set(filePath, { mtimeMs, title });
  return title;
}

function listDiskDashboards(): DashboardEntry[] {
  let files: string[] = [];
  try {
    files = dashboardRepository.listJsonFiles();
  } catch (_) {
    files = [];
  }

  const entries: DashboardEntry[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const id = path.basename(file, '.json');
    if (!DASHBOARD_ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, title: diskTitle(path.join(DASHBOARD_DIR, file)), companyId: null, source: 'file' });
  }
  return entries;
}

async function dashboardExists(dashboardId: any): Promise<boolean> {
  if (!DASHBOARD_ID_RE.test(String(dashboardId || ''))) return false;
  try {
    if (await dashboardRepository.existsInDb(dashboardId)) return true;
  } catch (_) {}
  return dashboardRepository.fileExists(registryPathFor(dashboardId));
}

async function listDashboards(companyId: number | null | undefined = undefined): Promise<DashboardEntry[]> {
  const entries: DashboardEntry[] = [];
  const seen = new Set<string>();

  try {
    for (const row of await dashboardRepository.list(companyId)) {
      seen.add(row.id);
      entries.push({
        id: row.id,
        title: row.title,
        description: row.description,
        companyId: row.companyId,
        createdBy: row.createdBy,
        source: 'database',
      });
    }
  } catch (_) {}

  for (const d of listDiskDashboards()) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      entries.push(d);
    }
  }

  return entries;
}

async function dashboardTitles(): Promise<Map<string, any>> {
  const all = await listDashboards();
  return new Map(all.map((d) => [d.id, d.title]));
}

async function countDashboards(): Promise<number> {
  return (await listDashboards()).length;
}

function invalidateSpecCache(dashboardId: unknown): void {
  if (dashboardId == null) {
    specCache.clear();
    return;
  }
  const id = String(dashboardId);
  specCache.delete(id);
  if (specPathFor(DEFAULT_DASHBOARD_ID) === DEFAULT_SPEC_PATH) {
    specCache.delete(DEFAULT_DASHBOARD_ID);
    const aliasId = defaultSpecId();
    if (aliasId) specCache.delete(aliasId);
  }
}

async function saveSpec(
  dashboardId: unknown,
  spec: Spec,
  { companyId = null, userId = null, title = null, description = null }: { companyId?: number | null; userId?: number | null; title?: string | null; description?: string | null } = {}
): Promise<string> {
  const id = assertValidDashboardId(dashboardId);
  const normalized = normalizeSpec(spec);

  await dashboardRepository.upsert({
    id,
    title: title || normalized.title || id,
    description: description !== undefined ? description : (normalized.description || null),
    companyId,
    userId,
    spec: normalized,
  });

  invalidateSpecCache(id);
  return id;
}

async function deleteDashboard(dashboardId: unknown): Promise<void> {
  const id = assertValidDashboardId(dashboardId);
  await dashboardRepository.removeWithGrants(id);
  invalidateSpecCache(id);
}

async function hydrateView(filters: Record<string, any> | null | undefined, spec: Spec): Promise<Record<string, any>> {
  const t0 = Date.now();
  const t1 = Date.now();
  const data = await hydrateDashboard(spec, filters || {});
  const t2 = Date.now();
  const result = hydratedView(spec, data);
  const t3 = Date.now();

  console.log(
    `[Dashboard] spec=${t1 - t0}ms engine=${t2 - t1}ms assemble=${t3 - t2}ms ` +
    `total=${t3 - t0}ms queries kpi=${data._stats.kpiQueries} card=${data._stats.cardQueries} ` +
    `slicer=${data._stats.slicerQueries} cacheHits=${data._stats.cacheHits || 0} ` +
    `errors=${data._stats.errors || 0}`
  );

  return result;
}

function newDashboardSpec(body: Record<string, any>, { id, title, description }: { id: string; title: string; description: string | null }): Spec {
  if (body.spec && typeof body.spec === 'object') {
    return { ...body.spec, id, title, description };
  }
  return {
    version: NEW_DASHBOARD_VERSION,
    id,
    title,
    description: description || '',
    dataSource: body.dataSource || { ...DEFAULT_DATA_SOURCE },
    layout: body.layout || structuredClone(DEFAULT_LAYOUT),
    slicers: Array.isArray(body.slicers) ? body.slicers : [],
    cards: Array.isArray(body.cards) ? body.cards : [],
  };
}

async function createDashboard(actor: Actor, body: Record<string, any> = {}): Promise<Record<string, any>> {
  const title = requireString(body.title, 'Dashboard title', { min: 2, max: 150 });
  const description = body.description ? String(body.description).trim() : null;

  let id: string | null = body.id ? String(body.id).trim() : null;
  if (!id) {
    const baseSlug = dashboardSlugify(title) || 'dashboard';
    id = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  }
  assertValidDashboardId(id);

  if (await dashboardExists(id)) {
    throw fail('CONFLICT', `A dashboard with id "${id}" already exists.`);
  }

  const companyId = actor.isPlatform
    ? (body.companyId ? Number(body.companyId) : null)
    : actor.companyId;

  const spec = newDashboardSpec(body, { id, title, description });

  await saveSpec(id, spec, { companyId, userId: actor.id, title, description });
  await accessRepository.grantCreatorAdmin(actor.id, id);
  if (companyId) await accessRepository.assignIfMissing(companyId, id, actor.id);

  audit(EVENTS.DASHBOARD_CREATED, actor, { dashboardId: id, companyId });

  return { id, title, description, companyId, accessLevel: 'admin', spec };
}

async function viewDashboard(dashboardId: unknown, filters: Record<string, any> | null | undefined, accessLevel: unknown): Promise<Record<string, any>> {
  const view = await hydrateView(filters, await getSpec(dashboardId));
  return { ...view, accessLevel };
}

async function updateCard(actor: Actor, dashboardId: string, { index, card, filters }: { index: number; card: any; filters?: Record<string, any> | null }, accessLevel: unknown): Promise<Record<string, any>> {
  const spec = await getSpec(dashboardId);
  if (!actor.isPlatform) {
    const allowed = await accessRepository.companyDashboardIds(actor.companyId);
    if (!allowed.has(dashboardId)) {
      throw fail('TENANT_ACCESS_DENIED', 'This dashboard is not assigned to your company.');
    }
    if (spec.companyId !== null && spec.companyId !== undefined && spec.companyId !== actor.companyId) {
      throw fail('TENANT_ACCESS_DENIED', 'This dashboard does not belong to your company.');
    }
  }

  if (!Array.isArray(spec.cards) || index < 0 || index >= spec.cards.length) {
    throw fail('VALIDATION_ERROR', 'Card index out of bounds');
  }

  spec.cards[index] = flattenCard(card);
  await saveSpec(dashboardId, spec, {
    companyId: spec.companyId,
    userId: actor.id,
    title: spec.title,
    description: spec.description,
  });

  const view = await hydrateView(filters || {}, await getSpec(dashboardId));
  audit(EVENTS.DASHBOARD_UPDATED, actor, { dashboardId, cardIndex: index });
  return { ...view, accessLevel };
}

async function removeDashboard(actor: Actor, dashboardId: string): Promise<{ deleted: true; dashboardId: string }> {
  const spec = await getSpec(dashboardId);

  if (!actor.isPlatform) {
    if (spec.companyId === null) {
      throw fail('TENANT_ACCESS_DENIED', 'Only platform administrators can delete platform templates.');
    }
    if (spec.companyId !== actor.companyId) {
      throw fail('TENANT_ACCESS_DENIED', 'This dashboard does not belong to your company.');
    }
  }

  await deleteDashboard(dashboardId);
  audit(EVENTS.DASHBOARD_DELETED, actor, { dashboardId, companyId: spec.companyId });
  return { deleted: true, dashboardId };
}

async function describeColumns(dashboardId: unknown): Promise<any> {
  const spec = await getSpec(dashboardId);
  const meta = await resolveSourceMetadata(spec);
  const rowCount = await queryRepository.countRows(meta.table.schema, meta.table.table);
  return columnCatalogue(spec, meta, rowCount);
}

async function previewCard(dashboardId: unknown, { card, filters }: { card: any; filters?: Record<string, any> | null }): Promise<Record<string, any>> {
  const draft = flattenCard(card);
  const spec = await getSpec(dashboardId);
  const data = await hydrateDashboard({ ...spec, cards: [draft] }, filters || {});
  return {
    kind: cardKind(draft),
    visual: data.cards[0] || null,
    error: (data.errors || [])[0] || null,
  };
}

export {
  getSpec,
  listDashboards,
  dashboardExists,
  dashboardTitles,
  countDashboards,
  saveSpec,
  deleteDashboard,
  createDashboard,
  viewDashboard,
  updateCard,
  removeDashboard,
  describeColumns,
  previewCard,
};
