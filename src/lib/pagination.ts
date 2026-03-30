export interface PaginationInput {
  page?: number
  pageSize?: number
}

export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginationSlice {
  page: number
  pageSize: number
  offset: number
  limit: number
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export function parsePaginationParams(searchParams: URLSearchParams): PaginationSlice | null {
  const hasPage = searchParams.has('page')
  const hasPageSize = searchParams.has('pageSize')
  if (!hasPage && !hasPageSize) return null

  const page = Math.max(DEFAULT_PAGE, Number(searchParams.get('page') || DEFAULT_PAGE) || DEFAULT_PAGE)
  const requestedPageSize = Number(searchParams.get('pageSize') || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize))
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize
  }
}

export function normalizePagination(input?: PaginationInput | null): PaginationSlice | null {
  if (!input) return null
  const hasAny = input.page !== undefined || input.pageSize !== undefined
  if (!hasAny) return null
  const page = Math.max(DEFAULT_PAGE, Number(input.page || DEFAULT_PAGE) || DEFAULT_PAGE)
  const requestedPageSize = Number(input.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize))
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    limit: pageSize
  }
}

export function paginateArray<T>(items: T[], pagination: PaginationSlice) {
  const total = items.length
  const sliced = items.slice(pagination.offset, pagination.offset + pagination.limit)
  return {
    items: sliced,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize))
    } satisfies PaginationMeta
  }
}
