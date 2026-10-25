// src/shared/pagination.ts - Pagination utilities
import { PAGINATION } from '../config/constants.js';
import type { ApiPagination } from '../types/api.types.js';

const MAX_PAGE_LIMIT = 100_000;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function parsePaginationParams(
  query: { page?: string | number; pageSize?: string | number } = {}
): PaginationParams {
  const rawPage = query.page !== undefined ? String(query.page) : undefined;
  const rawPageSize = query.pageSize !== undefined ? String(query.pageSize) : undefined;
  const parsedPage = parseInt(rawPage || String(PAGINATION.DEFAULT_PAGE), 10);
  const parsedPageSize = parseInt(rawPageSize || String(PAGINATION.DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(
    PAGINATION.MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(parsedPageSize) ? parsedPageSize : PAGINATION.DEFAULT_PAGE_SIZE)
  );

  // Bound deep pagination and keep metadata and offsets consistent before multiplying.
  const maxPage = Math.min(
    MAX_PAGE_LIMIT,
    Number.MAX_SAFE_INTEGER,
    Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1
  );
  const page = Math.min(maxPage, Math.max(1, Number.isFinite(parsedPage) ? parsedPage : PAGINATION.DEFAULT_PAGE));

  return { page, pageSize };
}

export function createPagination(totalItems: number, params: PaginationParams): ApiPagination {
  const totalPages = Math.ceil(totalItems / params.pageSize);

  return {
    page: params.page,
    pageSize: params.pageSize,
    totalItems,
    totalPages,
    hasNextPage: params.page < totalPages,
    hasPrevPage: params.page > 1,
  };
}

export function getSkipCount(params: PaginationParams): number {
  return (params.page - 1) * params.pageSize;
}

export function buildSortOptions(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' = 'desc',
  allowedFields: string[]
): Record<string, 1 | -1> {
  if (!sortBy || !allowedFields.includes(sortBy)) {
    return { createdAt: sortOrder === 'asc' ? 1 : -1 };
  }

  const order = sortOrder === 'asc' ? 1 : -1;
  return { [sortBy]: order };
}
