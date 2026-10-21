import crypto from 'node:crypto';
import path from 'node:path';
import config from '../../config';
import * as dashboardRepository from './dashboardRepository';
import * as accessRepository from '../access/accessRepository';
import * as queryRepository from '../queryEngine/queryRepository';
import { fail, DashboardNotFoundError } from '../../shared/errors/AppError';
import { dashboardSlugify } from '../../shared/text/slugify';
import { assertValidDashboardId } from './dashboardValidator';
import { requireString } from '../../shared/validation/commonValidator';
import { normalizeSpec, flattenCard, cardKind, isList, isRecord } from './cardModel';
import { columnCatalogue, hydratedView } from './dashboardSerializer';
import { hydrateDashboard } from '../queryEngine/queryEngineService';
import { resolveSourceMetadata } from '../queryEngine/metadataService';
import { audit, EVENTS } from '../audit/auditService';
import { assertPermission } from '../auth/authorizationService';
import { DASHBOARD_ID_RE, NEW_DASHBOARD_VERSION, DEFAULT_DATA_SOURCE, DEFAULT_LAYOUT } from './dashboardConstants';
import type { Actor } from '../../shared/types/actor';
import type { CardUpdate, DraftCard } from './dashboardValidator';
import type {
  AccessLevel,
  CardPreview,
  ColumnCatalogue,
  CreatedDashboard,
  DashboardAccessView,
  DashboardDraft,
  DashboardEntry,
  DashboardSpec,
  DashboardView,
  SlicerSelections,
} from './dashboardTypes';

const { DEFAULT_DASHBOARD_ID } = config.engine;

const { DASHBOARD_DIR, DEFAULT_SPEC_PATH } = dashboardRepository;

const specCache = new Map<string, DashboardSpec>();
const diskTitleCache = new Map<string, { mtimeMs: number; title: string | undefined }>();

function readSpecFile(filePath: string): DashboardSpec {
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

async function getSpec(dashboardId: unknown): Promise<DashboardSpec> {
  const id = assertValidDashboardId(dashboardId);
  const cached = specCache.get(id);
  if (cached) return cached;

  try {
    const row = await dashboardRepository.findById(id);
    if (row?.deleted) throw new DashboardNotFoundError(id);
    if (row) {
      const stored: unknown = typeof row.spec === 'string' ? JSON.parse(row.spec) : row.spec;
      const spec = normalizeSpec(stored);
      if (!spec.id) spec.id = row.id;
      if (!spec.title && row.title) spec.title = row.title;
      if (!spec.description && row.description) spec.description = row.description;
      spec.companyId = row.company_id;
      specCache.set(id, spec);
      return spec;
    }
  } catch (err) {
    if (err instanceof DashboardNotFoundError) throw err;
  }

  const filePath = specPathFor(id);
  if (filePath) {
    const spec = readSpecFile(filePath);
    specCache.set(id, spec);
    return spec;
  }

  throw new DashboardNotFoundError(id);
}

function diskTitle(filePath: string): string | undefined {
  let mtimeMs: number;
  try {
    mtimeMs = dashboardRepository.fileMtime(filePath);
  } catch (_) {
    diskTitleCache.delete(filePath);
    return undefined;
  }
  const cached = diskTitleCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.title;
  let title: string | undefined;
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

async function dashboardExists(dashboardId: string): Promise<boolean> {
  if (!DASHBOARD_ID_RE.test(String(dashboardId || ''))) return false;
  try {
    const state = await dashboardRepository.rowState(dashboardId);
    if (state) return state === 'live';
  } catch (_) {}
  return dashboardRepository.fileExists(registryPathFor(dashboardId));
}

async function dashboardIdTaken(dashboardId: string): Promise<boolean> {
  try {
    if (await dashboardRepository.existsInDb(dashboardId)) return true;
  } catch (_) {}
  return dashboardRepository.fileExists(registryPathFor(dashboardId));
}

async function listDashboards(companyId: number | null | undefined = undefined): Promise<DashboardEntry[]> {
  const entries: DashboardEntry[] = [];
  const seen = new Set<string>();

  try {
    for (const id of await dashboardRepository.deletedIds()) seen.add(id);
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

async function dashboardTitles(): Promise<Map<string, string | undefined>> {
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
  spec: unknown,
  {
    companyId = null,
    userId = null,
    title = null,
    description = null,
  }: { companyId?: number | null; userId?: number | null; title?: string | null; description?: string | null } = {}
): Promise<string> {
  const id = assertValidDashboardId(dashboardId);
  const normalized = normalizeSpec(spec);

  await dashboardRepository.upsert({
    id,
    title: title || normalized.title || id,
    description: description !== undefined ? description : normalized.description || null,
    companyId,
    userId,
    spec: normalized,
  });

  invalidateSpecCache(id);
  return id;
}

async function deleteDashboard(dashboardId: unknown, deletedBy: number | null = null): Promise<void> {
  const spec = await getSpec(dashboardId);
  const id = assertValidDashboardId(dashboardId);
  await dashboardRepository.softDelete({
    id,
    title: spec.title || id,
    companyId: spec.companyId ?? null,
    spec,
    deletedBy,
  });
  invalidateSpecCache(id);
}

async function hydrateView(filters: SlicerSelections | null | undefined, spec: DashboardSpec): Promise<DashboardView> {
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

function newDashboardSpec(
  body: Record<string, unknown>,
  { id, title, description }: { id: string; title: string; description: string | null }
): DashboardDraft {
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
    slicers: isList(body.slicers) ? body.slicers : [],
    cards: isList(body.cards) ? body.cards : [],
  };
}

async function createDashboard(actor: Actor, payload: unknown = {}): Promise<CreatedDashboard> {
  const body: Record<string, unknown> = isRecord(payload) ? payload : {};
  const title = requireString(body.title, 'Dashboard title', { min: 2, max: 150 });
  const description = body.description ? String(body.description).trim() : null;

  let id: string | null = body.id ? String(body.id).trim() : null;
  if (!id) {
    const baseSlug = dashboardSlugify(title) || 'dashboard';
    id = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  }
  assertValidDashboardId(id);

  if (await dashboardIdTaken(id)) {
    throw fail('CONFLICT', `A dashboard with id "${id}" already exists.`);
  }

  const companyId = actor.isPlatform ? (body.companyId ? Number(body.companyId) : null) : actor.companyId;

  const spec = newDashboardSpec(body, { id, title, description });

  await saveSpec(id, spec, { companyId, userId: actor.id, title, description });
  await accessRepository.grantCreatorAdmin(actor.id, id);
  if (companyId) await accessRepository.assignIfMissing(companyId, id, actor.id);

  audit(EVENTS.DASHBOARD_CREATED, actor, { dashboardId: id, companyId });

  return { id, title, description, companyId, accessLevel: 'admin', spec };
}

async function viewDashboard(
  dashboardId: unknown,
  filters: SlicerSelections | null | undefined,
  accessLevel: AccessLevel
): Promise<DashboardAccessView> {
  const view = await hydrateView(filters, await getSpec(dashboardId));
  return { ...view, accessLevel };
}

async function updateCard(
  actor: Actor,
  dashboardId: unknown,
  { index, card, filters }: CardUpdate,
  accessLevel: AccessLevel
): Promise<DashboardAccessView> {
  const id = assertValidDashboardId(dashboardId);
  const spec = await getSpec(id);
  if (!actor.isPlatform) {
    const allowed = await accessRepository.companyDashboardIds(actor.companyId);
    if (!allowed.has(id)) {
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
  await saveSpec(id, spec, {
    companyId: spec.companyId,
    userId: actor.id,
    title: spec.title,
    description: spec.description,
  });

  const view = await hydrateView(filters || {}, await getSpec(id));
  audit(EVENTS.DASHBOARD_UPDATED, actor, { dashboardId: id, cardIndex: index });
  return { ...view, accessLevel };
}

async function ownerOfAnyDashboard(dashboardId: string): Promise<{ companyId: number | null }> {
  const id = assertValidDashboardId(dashboardId);
  const row = await dashboardRepository.findById(id);
  if (row) return { companyId: row.company_id };
  const filePath = specPathFor(id);
  if (filePath) return { companyId: readSpecFile(filePath).companyId ?? null };
  throw new DashboardNotFoundError(id);
}

async function removeDashboard(
  actor: Actor,
  dashboardId: string,
  { permanent = false }: { permanent?: boolean } = {}
): Promise<{ deleted: true; dashboardId: string; permanent: boolean }> {
  if (permanent) assertPermission(actor, 'delete.permanent');
  const spec = permanent ? await ownerOfAnyDashboard(dashboardId) : await getSpec(dashboardId);

  if (!actor.isPlatform) {
    if (spec.companyId === null) {
      throw fail('TENANT_ACCESS_DENIED', 'Only platform administrators can delete platform templates.');
    }
    if (spec.companyId !== actor.companyId) {
      throw fail('TENANT_ACCESS_DENIED', 'This dashboard does not belong to your company.');
    }
  }

  if (permanent) {
    await dashboardRepository.purge(assertValidDashboardId(dashboardId));
    invalidateSpecCache(dashboardId);
  } else {
    await deleteDashboard(dashboardId, actor.id);
  }
  audit(EVENTS.DASHBOARD_DELETED, actor, { dashboardId, companyId: spec.companyId, soft: !permanent, permanent });
  return { deleted: true, dashboardId, permanent };
}

async function describeColumns(dashboardId: unknown): Promise<ColumnCatalogue> {
  const spec = await getSpec(dashboardId);
  const meta = await resolveSourceMetadata(spec);
  const rowCount = await queryRepository.countRows(meta.table.schema, meta.table.table);
  return columnCatalogue(spec, meta, rowCount);
}

async function previewCard(dashboardId: unknown, { card, filters }: DraftCard): Promise<CardPreview> {
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
