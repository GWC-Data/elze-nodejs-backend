import config from '../config';
import { executeQuery } from '../repositories/query.repository';
import QueryCache from '../tools/queryCache';
import { FilterResolutionError } from '../tools/AppError';
import { buildFilters, planKpi, planCard, planSlicer } from './queryPlanner.service';
import { optimizePlans } from './queryOptimizer.service';
import { generateSql } from './sqlGenerator.service';
import { resolveSourceMetadata } from './metadata.service';
import { formatKpi, formatMergedKpi, formatCard, formatSlicer } from './resultFormatter.service';
import { cardKind } from '../models/card.model';
import { DEFAULT_CHART_MIN_HEIGHT } from '../constants/dashboard';

const { REDIS_URL, REDIS_TTL, CACHE_PREFIX } = config.engine;
const { QUERY_CONCURRENCY: MAX_CONCURRENT } = config.app;

type Spec = Record<string, any>;
type Plan = Record<string, any>;
type Entry = Record<string, any>;
type Job = Record<string, any>;
type StageError = { stage: string; message: string };

const cache = new QueryCache(REDIS_URL, { ttl: REDIS_TTL, prefix: CACHE_PREFIX });

function dashboardKey(spec: Spec, meta: Record<string, any> | null | undefined): string {
  return (
    spec.id ||
    spec.title ||
    (meta && meta.source ? `${meta.source.database}.${meta.source.table}` : 'default')
  );
}

function describeError(err: any, stage: string): StageError {
  return {
    stage,
    message: err && err.message ? err.message : String(err),
  };
}

async function runQueryWithCache(query: Record<string, any>, dashKey: string, ttl?: number): Promise<{ rows: any; cached: boolean; elapsed: number }> {
  const key = cache.generateKey(dashKey, query.meta.type, query.sql, query.params);
  const cached = await cache.get(key);
  if (cached) {
    return { rows: cached, cached: true, elapsed: 0 };
  }
  const { rows, elapsed } = await executeQuery(query.sql, query.params);
  await cache.set(key, rows, ttl);
  return { rows, cached: false, elapsed };
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array(Math.min(limit, tasks.length))
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

function kpiErrorPayload(entry: Entry): Record<string, any> {
  const card = entry.card || {};
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
    error: entry.error,
    spec: card,
  };
}

function chartErrorPayload(entry: Entry, minHeight: number): Record<string, any> {
  const card = entry.card || {};
  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data: [],
    axes: {},
    series: [],
    options: { ...(card.options || {}), height: minHeight },
    error: entry.error,
    spec: card,
  };
}

function errorPayloadFor(entry: Entry, minHeight: number): Record<string, any> {
  return entry.kind === 'kpi' ? kpiErrorPayload(entry) : chartErrorPayload(entry, minHeight);
}

function slicerErrorPayload(entry: Entry): Record<string, any> {
  const slicer = entry.slicer || {};
  return {
    id: slicer.id,
    title: slicer.title,
    column: slicer.column,
    type: slicer.type || 'multi',
    span: slicer.span,
    showCount: slicer.showCount,
    options: [],
    error: entry.error,
  };
}

function planCardEntries(cards: Spec[] | null | undefined, filtersList: Plan[], meta: Record<string, any>): Entry[] {
  return (cards || []).map((card: Spec, specIndex: number) => {
    const kind = cardKind(card);
    const entry: Entry = { specIndex, card, kind };
    try {
      entry.plan = kind === 'kpi'
        ? planKpi(card, filtersList, meta, specIndex)
        : planCard(card, filtersList, meta, specIndex);
    } catch (err) {
      entry.error = describeError(err, 'plan');
    }
    return entry;
  });
}

function planSlicerEntries(slicers: Spec[] | null | undefined, meta: Record<string, any>): Entry[] {
  return (slicers || []).map((slicer: Spec, specIndex: number) => {
    const entry: Entry = { specIndex, slicer };
    try {
      entry.plan = planSlicer(slicer, meta, specIndex);
    } catch (err) {
      entry.error = describeError(err, 'plan');
    }
    return entry;
  });
}

async function hydrateDashboard(spec: Spec, filters?: Record<string, any> | null): Promise<Record<string, any>> {
  const meta = await resolveSourceMetadata(spec);

  let filtersList: Plan[];
  try {
    filtersList = buildFilters(spec, filters || {}, meta);
  } catch (err: any) {
    throw new FilterResolutionError(err.message);
  }

  const cardEntries = planCardEntries(spec.cards, filtersList, meta);
  const slicerEntries = planSlicerEntries(spec.slicers, meta);

  const cardByIndex = new Map(cardEntries.map((e) => [e.specIndex, e]));

  const periodPlans: Plan[] = [];
  const simplePlans: Plan[] = [];
  for (const entry of cardEntries) {
    if (!entry.plan || entry.kind !== 'kpi') continue;
    if (entry.plan.kind === 'kpi-period') periodPlans.push(entry.plan);
    else simplePlans.push(entry.plan);
  }
  const { optimizedKpiPlans } = optimizePlans({ periodPlans, simplePlans });

  const kpiEntriesForPlan = (plan: Plan): Entry[] =>
    (plan.kind === 'kpi-period-merged'
      ? plan.members.map((m: any) => cardByIndex.get(m.specIndex))
      : [cardByIndex.get(plan.specIndex)]
    ).filter(Boolean);

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

  const runnable: Job[] = [];
  for (const job of jobs) {
    try {
      job.query = generateSql(job.plan);
      runnable.push(job);
    } catch (err) {
      assignJobError(job, describeError(err, 'sql'));
    }
  }

  const dashKey = dashboardKey(spec, meta);
  const results = await runWithConcurrency(
    runnable.map((job) => () =>
      runQueryWithCache(job.query, dashKey)
        .then((r) => ({ ok: true, ...r }))
        .catch((err: any) => ({ ok: false, error: describeError(err, 'execute') }))
    ),
    MAX_CONCURRENT
  );
  runnable.forEach((job, i) => { job.result = results[i]; });

  const minHeight = spec.layout?.chart?.minHeight ?? DEFAULT_CHART_MIN_HEIGHT;

  for (const job of runnable) {
    if (!job.result || !job.result.ok) {
      assignJobError(job, (job.result && job.result.error) || describeError(new Error('Query produced no result'), 'execute'));
      continue;
    }
    const rows = job.result.rows;

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

  const errors: Record<string, any>[] = [];
  const collect = (entries: Entry[], key: string, errorPayload: (entry: Entry) => Record<string, any>): any[] =>
    entries
      .map((entry) => {
        if (entry.error) {
          errors.push({ kind: entry.kind || key, id: entry[key]?.id, ...entry.error });
          return errorPayload(entry);
        }
        return entry.formatted || null;
      })
      .filter(Boolean);

  const cards = collect(cardEntries, 'card', (e) => errorPayloadFor(e, minHeight));
  const slicers = collect(slicerEntries, 'slicer', slicerErrorPayload);

  const countJobs = (type: string): number => runnable.filter((j) => j.type === type).length;

  return {
    cards,
    slicers,
    errors,
    _stats: {
      kpiQueries: countJobs('kpi'),
      cardQueries: countJobs('chart'),
      slicerQueries: countJobs('slicer'),
      totalQueries: runnable.length,
      cacheHits: results.filter((r: any) => r && r.cached).length,
      errors: errors.length,
    },
  };
}

export { hydrateDashboard };
