import { MAX_PAGE_SIZE } from '../constants/pagination';

interface PageParams {
  page?: unknown;
  pageSize?: unknown;
}

function pageOf({ page, pageSize }: PageParams = {}, defaultSize: number, maxSize: number = MAX_PAGE_SIZE) {
  const p = Number.isInteger(Number(page)) && Number(page) >= 1 ? Number(page) : 1;
  const sizeRaw = Number(pageSize);
  const size = Number.isInteger(sizeRaw) && sizeRaw >= 1 ? Math.min(sizeRaw, maxSize) : defaultSize;
  return { page: p, pageSize: size, offset: (p - 1) * size };
}

export { pageOf };
