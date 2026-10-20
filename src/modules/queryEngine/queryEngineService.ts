import config from '../../config';
import { executeQuery } from './queryRepository';
import QueryCache from './queryCache';
import { FilterResolutionError } from '../../shared/errors/AppError';
import { buildFilters, planKpi, planCard, planSlicer } from './queryPlannerService';
import { optimizePlans } from './queryOptimizerService';
import { generateSql } from './sqlGeneratorService';
import { resolveSourceMetadata } from './metadataService';
import { formatKpi, formatMergedKpi, formatCard, formatSlicer } from './resultFormatterService';
import { cardKind } from '../dashboards/cardModel';
import { DEFAULT_CHART_MIN_HEIGHT } from '../dashboards/dashboardConstants';
import type { CardSpec, DashboardSpec, SlicerSelections, SlicerSpec } from '../dashboards/dashboardTypes';
import type {
  CachedQueryResult,
  CardItem,
  CardPlan,
  CardView,
  ChartErrorView,
  DashboardError,
  FilterNode,
  GeneratedSql,
  HydratedDashboard,
  KpiErrorView,
  KpiPeriodPlan,
  KpiPlan,
  KpiQueryPlan,
  KpiSimplePlan,
  ResultRow,
  SlicerErrorView,
  SlicerItem,
  SlicerPlan,
  SlicerView,
  SourceMetadata,
  StageError,
} from './queryTypes';

const { REDIS_URL, REDIS_TTL, CACHE_PREFIX } = config.engine;
const { QUERY_CONCURRENCY: MAX_CONCURRENT } = config.app;

interface CardEntryBase {
  specIndex: number;
  card: CardSpec;
  error?: StageError;
  formatted?: CardView | null;
}

interface KpiCardEntry extends CardEntryBase {
  kind: 'kpi';
  plan?: KpiPlan;
}

interface ChartCardEntry extends CardEntryBase {
  kind: 'chart';
  plan?: CardPlan;
}

type CardEntry = KpiCardEntry | ChartCardEntry;

interface SlicerEntry {
  specIndex: number;
  slicer: SlicerSpec;
  plan?: SlicerPlan;
  error?: StageError;
  formatted?: SlicerView;
}

interface KpiJob {
  type: 'kpi';
  plan: KpiQueryPlan;
}

interface ChartJob {
  type: 'chart';
  entry: ChartCardEntry;
  plan: CardPlan;
}

interface SlicerJob {
  type: 'slicer';
  entry: SlicerEntry;
  plan: SlicerPlan;
}

type Job = KpiJob | ChartJob | SlicerJob;

interface RunnableJob {
  job: Job;
  query: GeneratedSql;
}

type QueryOutcome = ({ ok: true } & CachedQueryResult) | { ok: false; error: StageError };

interface EntryIdentity {
  kind: string;
  id: string | undefined;
}

const cache = new QueryCache(REDIS_URL, { ttl: REDIS_TTL, prefix: CACHE_PREFIX });

function isRowList(value: unknown): value is ResultRow[] {
  return Array.isArray(value);
}

function dashboardKey(spec: DashboardSpec, meta: SourceMetadata | null | undefined): string {
  return spec.id || spec.title || (meta?.source ? `${meta.source.database}.${meta.source.table}` : 'default');
}

function errorMessageOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'message' in err ? err.message : undefined;
}

function describeError(err: unknown, stage: string): StageError {
  const message = errorMessageOf(err);
  return {
    stage,
    message: typeof message === 'string' && message ? message : String(err),
  };
}

async function runQueryWithCache(query: GeneratedSql, dashKey: string, ttl?: number): Promise<CachedQueryResult> {
  const key = cache.generateKey(dashKey, query.meta.type, query.sql, query.params);
  const cached = await cache.get(key);
  if (isRowList(cached)) {
    return { rows: cached, cached: true, elapsed: 0 };
  }
  const { rows, elapsed } = await executeQuery(query.sql, query.params);
  await cache.set(key, rows, ttl);
  return { rows, cached: false, elapsed };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array<null>(Math.min(limit, tasks.length))
    .fill(null)
    .map(async () => {
      while (next < tasks.length) {
        const i = next;
        next += 1;
        results[i] = await tasks[i]();
      }
    });
  await Promise.all(workers);
  return results;
}

function kpiErrorPayload(entry: CardEntry, error: StageError): KpiErrorView {
  const card: CardSpec = entry.card || {};
  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    value: 0,
    text: '',
    format: {},
    color: null,
    comparison: { label: '', delta: 0, deltaText: '', previousText: '', period: '', previousPeriod: '' },
    error,
    spec: card,
  };
}

function chartErrorPayload(entry: CardEntry, error: StageError, minHeight: number): ChartErrorView {
  const card: CardSpec = entry.card || {};
  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data: [],
    axes: {},
    series: [],
    options: { ...(card.options || {}), height: minHeight },
    error,
    spec: card,
  };
}

function errorPayloadFor(entry: CardEntry, error: StageError, minHeight: number): KpiErrorView | ChartErrorView {
  return entry.kind === 'kpi' ? kpiErrorPayload(entry, error) : chartErrorPayload(entry, error, minHeight);
}

function slicerErrorPayload(entry: SlicerEntry, error: StageError): SlicerErrorView {
  const slicer: Partial<SlicerSpec> = entry.slicer || {};
  return {
    id: slicer.id,
    title: slicer.title,
    column: slicer.column,
    type: slicer.type || 'multi',
    span: slicer.span,
    showCount: slicer.showCount,
    options: [],
    error,
  };
}

function planCardEntries(
  cards: CardSpec[] | null | undefined,
  filtersList: FilterNode[],
  meta: SourceMetadata
): CardEntry[] {
  return (cards || []).map((card, specIndex) => {
    const kind = cardKind(card);
    const entry: CardEntry = { specIndex, card, kind };
    try {
      if (entry.kind === 'kpi') entry.plan = planKpi(card, filtersList, meta, specIndex);
      else entry.plan = planCard(card, filtersList, meta, specIndex);
    } catch (err) {
      entry.error = describeError(err, 'plan');
    }
    return entry;
  });
}

function planSlicerEntries(slicers: SlicerSpec[] | null | undefined, meta: SourceMetadata): SlicerEntry[] {
  return (slicers || []).map((slicer, specIndex) => {
    const entry: SlicerEntry = { specIndex, slicer };
    try {
      entry.plan = planSlicer(slicer, meta, specIndex);
    } catch (err) {
      entry.error = describeError(err, 'plan');
    }
    return entry;
  });
}

function collect<E extends { error?: StageError }, V extends object>(
  entries: E[],
  errors: DashboardError[],
  identify: (entry: E) => EntryIdentity,
  errorPayload: (entry: E, error: StageError) => V,
  formattedOf: (entry: E) => V | null | undefined
): V[] {
  return entries
    .map((entry) => {
      if (entry.error) {
        errors.push({ ...identify(entry), ...entry.error });
        return errorPayload(entry, entry.error);
      }
      return formattedOf(entry) || null;
    })
    .filter((item): item is V => Boolean(item));
}

async function hydrateDashboard(spec: DashboardSpec, filters?: SlicerSelections | null): Promise<HydratedDashboard> {
  const meta = await resolveSourceMetadata(spec);

  let filtersList: FilterNode[];
  try {
    filtersList = buildFilters(spec, filters || {}, meta);
  } catch (err) {
    throw new FilterResolutionError(err instanceof Error ? err.message : String(err));
  }

  const cardEntries = planCardEntries(spec.cards, filtersList, meta);
  const slicerEntries = planSlicerEntries(spec.slicers, meta);

  const cardByIndex = new Map(cardEntries.map((e) => [e.specIndex, e]));

  const periodPlans: KpiPeriodPlan[] = [];
  const simplePlans: KpiSimplePlan[] = [];
  for (const entry of cardEntries) {
    if (!entry.plan || entry.kind !== 'kpi') continue;
    if (entry.plan.kind === 'kpi-period') periodPlans.push(entry.plan);
    else simplePlans.push(entry.plan);
  }
  const { optimizedKpiPlans } = optimizePlans({ periodPlans, simplePlans });

  const kpiEntriesForPlan = (plan: KpiQueryPlan): CardEntry[] =>
    (plan.kind === 'kpi-period-merged'
      ? plan.members.map((m) => cardByIndex.get(m.specIndex))
      : [cardByIndex.get(plan.specIndex)]
    ).filter((entry): entry is CardEntry => Boolean(entry));

  const jobs: Job[] = [];
  for (const plan of optimizedKpiPlans) jobs.push({ type: 'kpi', plan });
  for (const entry of cardEntries) {
    if (entry.kind === 'chart' && entry.plan) jobs.push({ type: 'chart', entry, plan: entry.plan });
  }
  for (const entry of slicerEntries) if (entry.plan) jobs.push({ type: 'slicer', entry, plan: entry.plan });

  const assignJobError = (job: Job, error: StageError): void => {
    if (job.type === 'kpi') {
      for (const entry of kpiEntriesForPlan(job.plan)) {
        if (!entry.error) entry.error = error;
      }
    } else if (!job.entry.error) {
      job.entry.error = error;
    }
  };

  const runnable: RunnableJob[] = [];
  for (const job of jobs) {
    try {
      runnable.push({ job, query: generateSql(job.plan) });
    } catch (err) {
      assignJobError(job, describeError(err, 'sql'));
    }
  }

  const dashKey = dashboardKey(spec, meta);
  const results = await runWithConcurrency(
    runnable.map(
      ({ query }) =>
        (): Promise<QueryOutcome> =>
          runQueryWithCache(query, dashKey)
            .then((r): QueryOutcome => ({ ok: true, ...r }))
            .catch((err: unknown): QueryOutcome => ({ ok: false, error: describeError(err, 'execute') }))
    ),
    MAX_CONCURRENT
  );

  const minHeight = spec.layout?.chart?.minHeight ?? DEFAULT_CHART_MIN_HEIGHT;

  for (const [i, { job }] of runnable.entries()) {
    const result = results[i];
    if (!result?.ok) {
      assignJobError(job, result?.error || describeError(new Error('Query produced no result'), 'execute'));
      continue;
    }
    const rows = result.rows;

    if (job.type === 'kpi') {
      if (job.plan.kind === 'kpi-period-merged') {
        for (const member of job.plan.members) {
          const entry = cardByIndex.get(member.specIndex);
          if (!entry) continue;
          try {
            entry.formatted = formatMergedKpi(member, rows);
          } catch (err) {
            entry.error = describeError(err, 'format');
          }
        }
      } else {
        const entry = cardByIndex.get(job.plan.specIndex);
        if (entry) {
          try {
            entry.formatted = formatKpi(job.plan.kpi, rows);
          } catch (err) {
            entry.error = describeError(err, 'format');
          }
        }
      }
    } else if (job.type === 'chart') {
      try {
        const formatted = formatCard(job.entry.card, rows, minHeight);
        job.entry.formatted = formatted ? { ...formatted, spec: job.entry.card } : null;
      } catch (err) {
        job.entry.error = describeError(err, 'format');
      }
    } else {
      try {
        job.entry.formatted = formatSlicer(job.entry.slicer, rows, filters);
      } catch (err) {
        job.entry.error = describeError(err, 'format');
      }
    }
  }

  const errors: DashboardError[] = [];

  const cards = collect<CardEntry, CardItem>(
    cardEntries,
    errors,
    (entry) => ({ kind: entry.kind || 'card', id: entry.card?.id }),
    (entry, error) => errorPayloadFor(entry, error, minHeight),
    (entry) => entry.formatted
  );
  const slicers = collect<SlicerEntry, SlicerItem>(
    slicerEntries,
    errors,
    (entry) => ({ kind: 'slicer', id: entry.slicer?.id }),
    slicerErrorPayload,
    (entry) => entry.formatted
  );

  const countJobs = (type: Job['type']): number => runnable.filter(({ job }) => job.type === type).length;

  return {
    cards,
    slicers,
    errors,
    _stats: {
      kpiQueries: countJobs('kpi'),
      cardQueries: countJobs('chart'),
      slicerQueries: countJobs('slicer'),
      totalQueries: runnable.length,
      cacheHits: results.filter((r) => r.ok && r.cached).length,
      errors: errors.length,
    },
  };
}

export { hydrateDashboard };
