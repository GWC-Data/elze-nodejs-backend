import { quoteIdentifier, quoteQualified } from '../tools/sql';
import {
  resolvedName,
  buildAggExpression,
  buildDateGroupExpression,
  buildNonEmptyCondition,
  buildWhereSql,
  resolveSortDirection,
} from './semanticLayerService';

type Plan = Record<string, any>;
type PlanNode = Record<string, any>;
type GeneratedSql = { sql: string; params: any[]; meta: { type: string; plan: Plan } };

function ref(node: PlanNode): string {
  return quoteIdentifier(resolvedName(node));
}

function alias(node: PlanNode): string {
  return quoteIdentifier(node.column);
}

function tableRef(source: PlanNode): string {
  return quoteQualified(source.schema, source.table);
}

function dateSelect(dateGroup: PlanNode): string {
  return buildDateGroupExpression(resolvedName(dateGroup), dateGroup.grain, dateGroup);
}

function orderTerm(term: PlanNode): string {
  const direction = resolveSortDirection(term.direction);
  if (term.dateGroup) {
    return `${alias(term.dateGroup)} ${direction}`;
  }
  if (term.aggregation) {
    return `${buildAggExpression(term.aggregation, resolvedName(term))} ${direction}`;
  }
  return `${ref(term)} ${direction}`;
}

function generateKpiPeriodSql(plan: Plan): GeneratedSql {
  const table = tableRef(plan.source);
  const { where, params } = buildWhereSql(plan.filters);

  if (plan.kind === 'kpi-period-merged') {
    const selects = [dateSelect(plan.dateGroup) + ' AS "_period"'];
    for (const member of plan.members) {
      selects.push(
        buildAggExpression(member.measure.aggregation, resolvedName(member.measure), member.alias)
      );
    }
    const sql = `SELECT ${selects.join(', ')} FROM ${table}${where} GROUP BY "_period" ORDER BY "_period" ASC`;
    return { sql, params, meta: { type: plan.kind, plan } };
  }

  const select = `${dateSelect(plan.dateGroup)} AS "_period", ${buildAggExpression(
    plan.measures[0].aggregation,
    resolvedName(plan.measures[0]),
    '_value'
  )}`;
  const sql = `SELECT ${select} FROM ${table}${where} GROUP BY "_period" ORDER BY "_period" ASC`;
  return { sql, params, meta: { type: plan.kind, plan } };
}

function generateKpiSimpleSql(plan: Plan): GeneratedSql {
  const table = tableRef(plan.source);
  const { where, params } = buildWhereSql(plan.filters);
  const select = buildAggExpression(plan.measures[0].aggregation, resolvedName(plan.measures[0]), '_value');
  const sql = `SELECT ${select} FROM ${table}${where}`;
  return { sql, params, meta: { type: plan.kind, plan } };
}

function generateCardSql(plan: Plan): GeneratedSql {
  const table = tableRef(plan.source);
  const { where, params } = buildWhereSql(plan.filters);

  const selectParts: string[] = [];
  const groupParts: string[] = [];

  if (plan.dateGroup) {
    const expr = dateSelect(plan.dateGroup);
    selectParts.push(`${expr} AS ${alias(plan.dateGroup)}`);
    groupParts.push(expr);
  }

  for (const d of plan.dimensions) {
    selectParts.push(`${ref(d)} AS ${alias(d)}`);
    groupParts.push(ref(d));
  }

  for (const m of plan.measures) {
    selectParts.push(buildAggExpression(m.aggregation, resolvedName(m), m.alias));
  }

  const groupBy = groupParts.length ? ' GROUP BY ' + groupParts.join(', ') : '';

  let orderBy = '';
  if (plan.orderBy && plan.orderBy.length) {
    orderBy = ' ORDER BY ' + plan.orderBy.map(orderTerm).join(', ');
  } else if (plan.dateGroup) {
    orderBy = ` ORDER BY ${alias(plan.dateGroup)} ASC`;
  } else if (plan.measures.length && plan.dimensions.length) {
    const first = plan.measures[0];
    orderBy = ` ORDER BY ${buildAggExpression(first.aggregation, resolvedName(first))} DESC`;
  }

  const limit = plan.limit ? ` LIMIT ${plan.limit}` : '';

  const sql = `SELECT ${selectParts.join(', ')} FROM ${table}${where}${groupBy}${orderBy}${limit}`;
  return { sql, params, meta: { type: plan.kind, plan } };
}

function generateSlicerSql(plan: Plan): GeneratedSql {
  const col = ref(plan);
  const table = tableRef(plan.source);
  const condition = buildNonEmptyCondition(resolvedName(plan), plan.columnMeta);
  const sql =
    `SELECT ${col} AS "value", COUNT(*) AS "count" FROM ${table} ` +
    `WHERE ${condition} GROUP BY ${col} ORDER BY ${col} ASC`;
  return { sql, params: [], meta: { type: plan.kind, plan } };
}

function generateSql(plan: Plan): GeneratedSql {
  switch (plan.kind) {
    case 'kpi-period-merged':
    case 'kpi-period':
      return generateKpiPeriodSql(plan);
    case 'kpi-simple':
      return generateKpiSimpleSql(plan);
    case 'card':
      return generateCardSql(plan);
    case 'slicer':
      return generateSlicerSql(plan);
    default:
      throw new Error(`Unknown plan kind: ${plan.kind}`);
  }
}

export {
  generateSql,
};
