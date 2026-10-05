import { formatPeriodDisplay, parsePeriodKey } from './semanticLayer.service';
import { kpiValueColumn, readKpiPeriod } from './queryPlanner.service';
import { PALETTE, ABBREVIATE_ABOVE } from '../constants/query';

type Spec = Record<string, any>;
type Row = Record<string, any>;
type Format = Record<string, any> | null | undefined;

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function formatValue(value: unknown, format: Format): string {
  const f = format || {};
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const prefix = f.prefix ?? '';
  const suffix = f.suffix ?? '';
  const declared = f.type || f.format;
  const abbr = declared
    ? f.type === 'abbreviated' || f.format === '#A'
    : Math.abs(n) >= ABBREVIATE_ABOVE;
  const rendered = abbr
    ? COMPACT.format(n)
    : n.toLocaleString('en-US', {
        minimumFractionDigits: f.digits ?? 0,
        maximumFractionDigits: f.digits ?? 0,
      });
  return `${prefix}${rendered}${suffix}`;
}

function formatShare(value: unknown, total: number): string {
  if (!total) return '';
  const pct = (Number(value) / total) * 100;
  if (!Number.isFinite(pct)) return '';
  return `${pct.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return factor * mag;
}

function axisTicks(min: number, max: number, format: Format, count = 5): { value: number; label: string }[] {
  const lo = Math.min(0, Number.isFinite(min) ? min : 0);
  const hi = Math.max(0, Number.isFinite(max) ? max : 0);
  if (hi === lo) return [{ value: 0, label: formatValue(0, format) }];

  const step = niceStep((hi - lo) / count);
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks: { value: number; label: string }[] = [];
  for (let v = start; v <= end + step / 2; v += step) {
    const value = Number(Number(v).toPrecision(12));
    ticks.push({ value, label: formatValue(value, format) });
  }
  return ticks;
}

function periodRows(rows: Row[], grain: unknown): { _period: any; _value: number }[] {
  return rows
    .map((r) => ({
      _period: r._period,
      _value: Number(r._value) || 0,
    }))
    .sort((a, b) => parsePeriodKey(a._period, grain) - parsePeriodKey(b._period, grain));
}

function computeComparisonResult(rows: Row[], valueDisplay: string, grain: unknown): Record<string, any> {
  const sorted = periodRows(rows, grain);
  if (!sorted.length) return { delta: 0, current: 0, previous: undefined, bucket: undefined, prevBucket: undefined };

  const last = sorted[sorted.length - 1];
  const prevBucket = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;

  const cur = Number(last._value) || 0;
  const prev = prevBucket ? Number(prevBucket._value) || 0 : undefined;

  let delta: number;
  if ((valueDisplay || 'percent') === 'percent') {
    delta = prev !== undefined && prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : cur !== 0 ? 100 : 0;
  } else {
    delta = prev !== undefined ? cur - prev : 0;
  }
  if (!Number.isFinite(delta)) delta = 0;

  return {
    delta,
    current: cur,
    previous: prev,
    bucket: last ? { name: formatPeriodDisplay(String(last._period), grain) } : undefined,
    prevBucket: prevBucket ? { name: formatPeriodDisplay(String(prevBucket._period), grain) } : undefined,
  };
}

function formatKpi(kpiSpec: Spec, rows: Row[] | null | undefined): Record<string, any> | null {
  if (!rows) return null;
  const vCol = kpiValueColumn(kpiSpec);
  if (!vCol) return null;

  const period = readKpiPeriod(kpiSpec);

  let comparisonResult: Record<string, any> | undefined;
  let value: number;

  if (period) {
    comparisonResult = computeComparisonResult(
      rows,
      String(kpiSpec.comparison?.comp_val_displayed || '').toLowerCase().includes('absolute')
        ? 'absolute'
        : 'percent',
      period.grain
    );
    value = comparisonResult.current;
  } else {
    value = rows[0] && rows[0]._value != null ? Number(rows[0]._value) || 0 : 0;
  }

  const format = vCol.format || kpiSpec.format || {};
  const text = formatValue(value, format);
  const previousText = comparisonResult?.prevBucket
    ? formatValue(comparisonResult.previous ?? 0, format)
    : '';

  return {
    id: kpiSpec.id,
    chartType: kpiSpec.chartType,
    title: kpiSpec.title || kpiSpec.name,
    description: kpiSpec.description,
    value,
    text,
    format,
    color: kpiSpec.options?.colorMapping?.[vCol.column] || kpiSpec.options?.color || null,
    comparison: {
      label: kpiSpec.comparison?.label || '',
      delta: comparisonResult?.delta ?? 0,
      deltaText: comparisonResult?.delta != null
        ? Math.abs(comparisonResult.delta).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + (kpiSpec.comparison?.deltaFormat?.suffix ?? '')
        : '',
      previousText,
      period: comparisonResult?.bucket?.name || '',
      previousPeriod: comparisonResult?.prevBucket?.name || '',
    },
    spec: kpiSpec,
  };
}

function formatMergedKpi(member: Spec, rows: Row[] | null | undefined): Record<string, any> | null {
  if (!rows) return null;
  const colKey = `${member.id}__value`;
  const mapped = rows.map((r) => ({
    _period: r._period,
    _value: r[colKey],
  }));
  return formatKpi(member.kpi, mapped);
}

function hasExplicitOrder(card: Spec): boolean {
  const raw = card.orderBy != null ? card.orderBy : (card.sort != null ? card.sort : card.sortBy);
  if (raw == null) return false;
  return Array.isArray(raw) ? raw.length > 0 : true;
}

function colorFor(card: Spec, key: string, i: number): string {
  const mapping = card.options?.colorMapping || {};
  if (mapping[key]) return mapping[key];
  if (card.options?.color && i === 0) return card.options.color;
  return PALETTE[i % PALETTE.length];
}

function formatCard(cardSpec: Spec, rows: Row[] | null | undefined, minHeight: number): Record<string, any> | null {
  if (!rows) return null;
  switch (cardSpec.chartType) {
    case 'line_bar_combo':
    case 'bar_line_combo':
    case 'combo':
      return formatCombo(cardSpec, rows, minHeight);
    case 'treemap':
    case 'tree_map':
    case 'hierarchy':
      return formatTreemap(cardSpec, rows, minHeight);
    case 'funnel':
    case 'conversion':
      return formatFunnel(cardSpec, rows, minHeight);
    case 'stacked_area':
    case 'area':
    case 'area_chart':
      return formatArea(cardSpec, rows, minHeight);
    default:
      return {
        id: cardSpec.id,
        chartType: cardSpec.chartType,
        title: cardSpec.title || cardSpec.name,
        description: cardSpec.description,
        data: [],
        axes: { x: { key: 'label', type: 'category' }, y: { key: 'value', type: 'number' } },
        series: [],
        options: { ...(cardSpec.options || {}), height: minHeight },
      };
  }
}

function formatCombo(card: Spec, rows: Row[], minHeight: number): Record<string, any> {
  const columns: any[] = card.columns || [];
  const valueCols = columns.filter((c) => c.mapping === 'VALUE');
  const xCol = columns.find((c) => c.mapping === 'XTIME') || columns.find((c) => c.mapping === 'ITEM');
  const gKey = card.groupBy?.[0]?.column || xCol?.column || 'label';
  const dualAxis = card.options?.dualAxis === true;
  const half = Math.ceil(valueCols.length / 2);

  const formatOf = (c: Record<string, any>): Format => c.format || card.format || null;

  const data = rows.map((r) => {
    const point: Record<string, any> = { [gKey]: r[gKey] ?? r.label ?? '', label: r[gKey] ?? r.label ?? '' };
    const text: Record<string, string> = {};
    for (const c of valueCols) {
      const n = Number(r[c.column]) || 0;
      point[c.column] = n;
      text[c.column] = formatValue(n, formatOf(c));
    }
    point.text = text;
    return point;
  });

  const series = valueCols.map((c, i) => ({
    key: c.column,
    name: c.alias || c.column,
    kind: dualAxis && i >= half ? 'line' : 'bar',
    axis: dualAxis && i >= half ? 'y2' : 'y1',
    color: colorFor(card, c.column, i),
  }));

  const extent = (cols: Record<string, any>[]): number[] => {
    const values: number[] = [];
    for (const c of cols) for (const r of rows) values.push(Number(r[c.column]) || 0);
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 0];
  };
  const y1Cols = valueCols.filter((_, i) => !(dualAxis && i >= half));
  const y2Cols = valueCols.filter((_, i) => dualAxis && i >= half);
  const [y1Min, y1Max] = extent(y1Cols);
  const [y2Min, y2Max] = extent(y2Cols);

  const axes = {
    x: { key: gKey, type: 'category' },
    y: {
      key: 'y1',
      type: 'number',
      ticks: axisTicks(y1Min, y1Max, formatOf(y1Cols[0] || {})),
    },
    ...(dualAxis
      ? { y2: { key: 'y2', type: 'number', ticks: axisTicks(y2Min, y2Max, formatOf(y2Cols[0] || {})) } }
      : {}),
  };

  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data,
    axes,
    series,
    options: { ...(card.options || {}), height: minHeight },
  };
}

function formatArea(card: Spec, rows: Row[], minHeight: number): Record<string, any> {
  const columns: any[] = card.columns || [];
  const xCol = columns.find((c) => c.mapping === 'XTIME') || columns.find((c) => c.mapping === 'ITEM');
  const seriesCol = columns.find((c) => c.mapping === 'SERIES');
  const valueCol = columns.find((c) => c.mapping === 'VALUE');
  const xKey = xCol?.column || 'label';
  const seriesName = seriesCol?.column || 'Series';
  const valueName = valueCol?.column || 'Value';
  const stacked = card.options?.stacked === true;

  const allSeries = Array.from(new Set(rows.map((r) => String(r[seriesName] ?? 'N/A'))));

  const dataMap: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    const label = String(r[xKey] ?? 'N/A');
    if (!dataMap[label]) {
      dataMap[label] = { [xKey]: label, label };
    }
    dataMap[label][String(r[seriesName] ?? 'N/A')] = Number(r[valueName]) || 0;
  }

  const valueFormat = valueCol?.format || card.format || null;

  const data = Object.values(dataMap).map((point) => {
    const text: Record<string, string> = {};
    for (const s of allSeries) {
      if (point[s] === undefined) point[s] = 0;
      text[s] = formatValue(point[s], valueFormat);
    }
    point.text = text;
    return point;
  });

  const series = allSeries.map((s, i) => ({
    key: s,
    name: s,
    kind: 'area',
    color: colorFor(card, s, i),
    stackId: stacked ? s : undefined,
    fillOpacity: 0.35,
  }));

  let axisMax = 0;
  let axisMin = 0;
  for (const point of data) {
    const stacks: Record<string, number> = {};
    for (const s of series) {
      const bucket = s.stackId || `_${s.key}`;
      stacks[bucket] = (stacks[bucket] || 0) + (Number(point[s.key]) || 0);
    }
    for (const v of Object.values(stacks)) {
      if (v > axisMax) axisMax = v;
      if (v < axisMin) axisMin = v;
    }
  }

  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data,
    axes: {
      x: { key: xKey, type: 'category' },
      y: { key: 'value', type: 'number', ticks: axisTicks(axisMin, axisMax, valueFormat) },
    },
    series,
    options: { ...(card.options || {}), height: minHeight },
  };
}

function formatTreemap(card: Spec, rows: Row[], minHeight: number): Record<string, any> {
  const columns: any[] = card.columns || [];
  const nameCol = columns.find((c) => c.mapping === 'SERIES') || columns.find((c) => c.mapping === 'XTIME') || columns.find((c) => c.mapping === 'ITEM');
  const valueCol = columns.find((c) => c.mapping === 'VALUE');
  const nameKey = nameCol?.column || card.groupBy?.[0]?.column || 'name';
  const valueKey = valueCol?.column || 'value';

  const valueFormat = valueCol?.format || card.format || null;

  const points = rows.map((r) => ({
    name: String(r[nameKey] ?? r.name ?? ''),
    value: Number(r[valueKey]) || 0,
  }));
  const ordered = hasExplicitOrder(card) ? points : points.sort((a, b) => b.value - a.value);
  const total = ordered.reduce((a, d) => a + d.value, 0);
  const data = ordered.map((d) => ({
    ...d,
    valueText: formatValue(d.value, valueFormat),
    shareText: formatShare(d.value, total),
  }));

  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data,
    axes: { x: { key: nameKey, type: 'category' }, y: { key: 'value', type: 'number' } },
    series: [],
    options: { ...(card.options || {}), height: minHeight, totalText: formatValue(total, valueFormat) },
  };
}

function formatFunnel(card: Spec, rows: Row[], minHeight: number): Record<string, any> {
  const columns: any[] = card.columns || [];
  const nameCol = columns.find((c) => c.mapping === 'SERIES') || columns.find((c) => c.mapping === 'ITEM') || columns.find((c) => c.mapping === 'XTIME');
  const valueCol = columns.find((c) => c.mapping === 'VALUE');
  const nameKey = nameCol?.column || card.groupBy?.[0]?.column || 'name';
  const valueKey = valueCol?.column || 'value';

  const valueFormat = valueCol?.format || card.format || null;

  const points = rows.map((r) => ({
    name: String(r[nameKey] ?? r.name ?? ''),
    value: Number(r[valueKey]) || 0,
  }));
  const ordered = hasExplicitOrder(card) ? points : points.sort((a, b) => b.value - a.value);
  const total = ordered.reduce((a, d) => a + d.value, 0);
  const data = ordered.map((d) => ({
    ...d,
    valueText: formatValue(d.value, valueFormat),
    shareText: formatShare(d.value, total),
  }));

  return {
    id: card.id,
    chartType: card.chartType,
    title: card.title || card.name,
    description: card.description,
    data,
    axes: { y: { key: nameKey, type: 'category' } },
    series: [],
    options: { ...(card.options || {}), height: minHeight },
  };
}

function formatSlicer(slicerSpec: Spec, rows: Row[] | null | undefined, filters: Record<string, any> | null | undefined): Record<string, any> {
  const values = rows || [];
  const selSet = new Set(filters?.[slicerSpec.id] || []);
  return {
    id: slicerSpec.id,
    title: slicerSpec.title,
    column: slicerSpec.column,
    type: slicerSpec.type || 'multi',
    span: slicerSpec.span,
    showCount: slicerSpec.showCount,
    options: values.map((v: Row) => ({ value: String(v.value), count: Number(v.count) || 0, selected: selSet.has(String(v.value)) })),
  };
}

export {
  formatKpi,
  formatMergedKpi,
  formatCard,
  formatSlicer,
};
