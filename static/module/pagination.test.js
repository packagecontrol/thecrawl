import { describe, expect, it } from 'vitest'
import { Pagination } from './pagination.js'

describe('Pagination', () => {
  it('treats an empty result set as one final page', () => {
    const pagination = calculatePagination([], 1)

    expect(pagination.totalPages).toBe(1)
    expect(pagination.isLastPage).toBe(true)
  })

  it('treats a single page of results as the final page', () => {
    const pagination = calculatePagination([{}], 1)

    expect(pagination.totalPages).toBe(1)
    expect(pagination.isLastPage).toBe(true)
  })

  it('only treats the final page of multiple pages as final', () => {
    const items = Array.from({ length: 25 }, () => ({}))

    expect(calculatePagination(items, 1).isLastPage).toBe(false)
    expect(calculatePagination(items, 2).isLastPage).toBe(true)
  })
})

function calculatePagination(items, page) {
  const pagination = new Pagination(null, items, page, null)
  pagination.calculate()
  return pagination
}
