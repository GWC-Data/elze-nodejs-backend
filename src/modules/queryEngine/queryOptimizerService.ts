import type { KpiMergedPlan, KpiPeriodPlan, KpiQueryPlan, KpiSimplePlan } from './queryTypes';

interface KpiPlanGroups {
  periodPlans?: KpiPeriodPlan[];
  simplePlans?: KpiSimplePlan[];
}

function planSignature(plan: KpiPeriodPlan): string {
  const src = plan.source ? [plan.source.database, plan.source.table] : [];
  const date = plan.dateGroup ? [plan.dateGroup.column, plan.dateGroup.grain, plan.dateGroup.parseFormat || ''] : null;
  const filters = (plan.filters || []).map((f) => [f.column, f.operator || 'IN', f.values || []]);
  return JSON.stringify([src, date, filters]);
}

function mergePeriodKpis(periodPlans: KpiPeriodPlan[]): Array<KpiPeriodPlan | KpiMergedPlan> {
  if (!periodPlans?.length) return [];

  const groups = new Map<string, KpiPeriodPlan[]>();
  for (const plan of periodPlans) {
    const sig = planSignature(plan);
    const group = groups.get(sig);
    if (group) group.push(plan);
    else groups.set(sig, [plan]);
  }

  const merged: Array<KpiPeriodPlan | KpiMergedPlan> = [];
  for (const plans of groups.values()) {
    if (plans.length === 1) {
      merged.push(plans[0]);
      continue;
    }

    const first = plans[0];
    merged.push({
      kind: 'kpi-period-merged',
      id: `kpis:${plans.map((p) => p.id).join('+')}`,
      specIndex: Math.min(...plans.map((p) => (p.specIndex == null ? 0 : p.specIndex))),
      source: first.source,
      members: plans.map((p) => ({
        id: p.id,
        specIndex: p.specIndex,
        kpi: p.kpi,
        measure: p.measures[0],
        alias: `${p.id}__value`,
      })),
      dateGroup: first.dateGroup,
      orderBy: [],
      filters: first.filters,
      limit: null,
    });
  }
  return merged;
}

function optimizePlans(kpiPlans: KpiPlanGroups): { optimizedKpiPlans: KpiQueryPlan[] } {
  const mergedKpiPlans = mergePeriodKpis(kpiPlans.periodPlans || []);
  const allKpiPlans = [...mergedKpiPlans, ...(kpiPlans.simplePlans || [])];
  return { optimizedKpiPlans: allKpiPlans };
}

export { optimizePlans };
