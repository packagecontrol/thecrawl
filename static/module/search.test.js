import { describe, expect, it, vi } from 'vitest'

import { processQueryString, Search } from './search.js'

describe('processQueryString', () => {
  it('returns an empty array for blank input', () => {
    expect(processQueryString('')).toEqual([])
    expect(processQueryString()).toEqual([])
  })

  it('extracts individual filters and free text in order', () => {
    const query = 'react author:dan label:"starter kit" platform:web'
    expect(processQueryString(query)).toEqual([
      {
        queries: ['dan'],
        fields: ['author'],
      },
      {
        queries: ['starter kit'],
        fields: ['labels'],
      },
      {
        combineWith: 'OR',
        queries: ['web', 'any'],
        fields: ['platforms'],
      },
      {
        queries: ['react'],
        fields: ['name', 'description', 'author'],
      },
    ])
  })

  it('supports quoted values for each filter', () => {
    expect(processQueryString('author:"Ada Lovelace" label:"data viz" platform:"desktop"')).toEqual([
      {
        queries: ['Ada Lovelace'],
        fields: ['author'],
      },
      {
        queries: ['data viz'],
        fields: ['labels'],
      },
      {
        combineWith: 'OR',
        queries: ['desktop', 'any'],
        fields: ['platforms'],
      },
    ])
  })

  it('handles multiple filters of the same type and remaining free text', () => {
    expect(processQueryString('label:Ada web label:Love component')).toEqual([
      {
        queries: ['Ada'],
        fields: ['labels'],
      },
      {
        queries: ['Love'],
        fields: ['labels'],
      },
      {
        queries: ['web', 'component'],
        fields: ['name', 'description', 'author'],
      },
    ])
  })
})

describe('Search.search', () => {
  it('passes parsed queries to minisearch and exposes filtered results', () => {
    const minisearch = {
      search: vi.fn().mockReturnValue([
        { id: 'pkg-1', score: 1.23, name: 'Example Package' },
      ]),
    }
    const search = new Search(minisearch)

    const results = search.search('author:someone')

    expect(minisearch.search).toHaveBeenCalledWith({
      combineWith: 'AND',
      queries: [
        {
          queries: ['someone'],
          fields: ['author'],
        },
      ],
    })
    expect(results).toEqual([
      { name: 'Example Package', score: 1.23 },
    ])
    expect(search.stringSearch).toBe(false)
  })

  it('marks stringSearch when a free text query is present', () => {
    const minisearch = {
      search: vi.fn().mockReturnValue([]),
    }
    const search = new Search(minisearch)

    search.search('react components')

    expect(search.stringSearch).toBe(true)
    expect(minisearch.search).toHaveBeenCalledWith({
      combineWith: 'AND',
      queries: [
        {
          queries: ['react', 'components'],
          fields: ['name', 'description', 'author'],
        },
      ],
    })
  })
})
