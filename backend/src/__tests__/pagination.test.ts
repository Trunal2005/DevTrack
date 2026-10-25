import { describe, expect, it } from 'vitest';
import { PAGINATION } from '../config/constants.js';
import { createPagination, getSkipCount, parsePaginationParams } from '../shared/pagination.js';

describe('pagination query normalization', () => {
  it.each([
    [undefined, undefined, PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['2', '10', 2, 10],
    ['', '', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['abc', 'abc', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    [' \t ', ' \t ', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['Infinity', '-Infinity', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['NaN', 'NaN', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['abcInfinity', 'Infinity100', PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['9'.repeat(400), '9'.repeat(400), PAGINATION.DEFAULT_PAGE, PAGINATION.DEFAULT_PAGE_SIZE],
    ['-2', '-10', 1, 1],
    ['0', '0', 1, 1],
    ['2', '101', 2, PAGINATION.MAX_PAGE_SIZE],
    ['2.9', '10.9', 2, 10],
    ['12abc', '10Infinity', 12, 10],
    ['1e3', '2e2', 1, 2],
    [' 2 ', ' 10 ', 2, 10],
  ])('normalizes page=%j, pageSize=%j to %i/%i', (page, pageSize, expectedPage, expectedSize) => {
    const params = parsePaginationParams({ page, pageSize });
    expect(params).toEqual({ page: expectedPage, pageSize: expectedSize });
    expect(getSkipCount(params)).toBe((expectedPage - 1) * expectedSize);
    expect(Number.isSafeInteger(getSkipCount(params))).toBe(true);
  });

  it.each([1, 2, 10, 20, 100])('bounds offsets before multiplication for pageSize=%i', (pageSize) => {
    const maxPage = Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1);
    for (const page of [maxPage - 1, maxPage, maxPage + 1, Number.MAX_SAFE_INTEGER, 1e20]) {
      const params = parsePaginationParams({ page: String(page), pageSize: String(pageSize) });
      expect(params).toEqual({ page: Math.min(page, maxPage), pageSize });
      const skip = getSkipCount(params);
      expect(Number.isSafeInteger(skip)).toBe(true);
      expect(skip).toBeGreaterThanOrEqual(0);
      expect(skip).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(createPagination(35, params)).toEqual({
        page: params.page, pageSize, totalItems: 35, totalPages: Math.ceil(35 / pageSize),
        hasNextPage: params.page < Math.ceil(35 / pageSize), hasPrevPage: params.page > 1,
      });
    }
  });

  it('preserves large supported pages and ordinary metadata', () => {
    const large = parsePaginationParams({ page: '1000000000', pageSize: '100' });
    expect(large.page).toBe(1_000_000_000);
    expect(getSkipCount(large)).toBe(99_999_999_900);
    expect(createPagination(35, parsePaginationParams({ page: '2', pageSize: '10' }))).toEqual({
      page: 2, pageSize: 10, totalItems: 35, totalPages: 4, hasNextPage: true, hasPrevPage: true,
    });
  });
});
