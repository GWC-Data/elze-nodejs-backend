interface ListParams {
  pageSize: number;
  offset: number;
  sort?: string;
  dir?: string;
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function orderBy(list: ListParams, sortable: Record<string, string>, tiebreak: string): string {
  const expression = sortable[String(list.sort)];
  const direction = list.dir === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${expression} ${direction} NULLS LAST, ${tiebreak}`;
}

export { likePattern, orderBy };
export type { ListParams };
