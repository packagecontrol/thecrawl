import MiniSearch from 'minisearch'
import { describe, expect, it, vi } from 'vitest'

import { createMinisearch } from './minisearch.js'
import { processQueryString, Search } from './search.js'
import * as searchModule from './search.js'

describe('processQueryString', () => {
  it('returns an empty array for blank input', () => {
    expect(processQueryString('').queries).toEqual([])
    expect(processQueryString().queries).toEqual([])
  })

  it('marks queries that have free text in it', () => {
    const query = 'web component'
    expect(processQueryString(query).hasFreeText).toBeTruthy()

    const query2 = 'label:web'
    expect(processQueryString(query2).hasFreeText).toBeFalsy()
  })

  it('extracts individual filters and free text in order', () => {
    const query = 'react author:dan label:"starter kit" platform:web'
    expect(processQueryString(query).queries).toEqual([
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
    expect(processQueryString('author:"Ada Lovelace" label:"data viz" platform:"desktop"').queries).toEqual([
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
    expect(processQueryString('label:Ada web label:Love component').queries).toEqual([
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

  it('treats disabled filters as free text', () => {
    const result = processQueryString(
      'author:someone label:ux platform:web',
      { author: false, label: false, platform: false },
    )

    expect(result.queries).toEqual([
      {
        queries: ['author:someone', 'label:ux', 'platform:web'],
        fields: ['name', 'description', 'author'],
      },
    ])
    expect(result.hasFreeText).toBe(true)
  })

  it('returns a filter function that enforces exact quoted matches', () => {
    const result = processQueryString('label:"color" author:"Palette" platform:"windows"')

    const passes = {
      labels: ['color'],
      author: 'Palette',
      platforms: ['windows'],
    }

    const failsLabel = {
      labels: ['color system'],
      author: 'Palette',
      platforms: ['windows'],
    }

    const failsAuthor = {
      labels: ['color'],
      author: 'Palette Systems',
      platforms: ['windows'],
    }

    const failsPlatform = {
      labels: ['color'],
      author: 'Palette',
      platforms: ['windows server'],
    }

    expect(result.filter(passes)).toBe(true)
    expect(result.filter(failsLabel)).toBe(false)
    expect(result.filter(failsAuthor)).toBe(false)
    expect(result.filter(failsPlatform)).toBe(false)
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

  it('passes configured filters to processQueryString', () => {
    const minisearch = {
      search: vi.fn().mockReturnValue([]),
    }
    const customFilters = {
      author: false,
      label: true,
      platform: false,
    }
    const processor = vi.spyOn(searchModule, 'processQueryString')
    const search = new Search(minisearch, { filters: customFilters }, processor)

    search.search('label:web platform:web')

    expect(processor).toHaveBeenCalledWith('label:web platform:web', customFilters)
    processor.mockRestore()
  })

  describe('Enslosed terms in "" finds exact matches', () => {
    const packages = [
      {
        name: 'ColorPalette',
        description: 'Color utilities',
        author: 'Palette',
        platforms: ['windows'],
        labels: ['color'],
      },
      {
        name: 'ColorSystem',
        description: 'Color system tooling',
        author: 'Palette Systems',
        platforms: ['windows server'],
        labels: ['color system'],
      },
    ]

    const createSearchInstance = () => new Search(createMinisearch(MiniSearch, packages))

    it('returns partial matches when using label:color', () => {
      const search = createSearchInstance()
      const results = search.search('label:color')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).toContain('ColorSystem')
    })

    it('returns the exact label match when using label:"color"', () => {
      const search = createSearchInstance()
      const results = search.search('label:"color"')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).not.toContain('ColorSystem')
    })

    it('returns partial matches when using author:Palette', () => {
      const search = createSearchInstance()
      const results = search.search('author:Palette')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).toContain('ColorSystem')
    })

    it('returns the exact author match when using author:"Palette"', () => {
      const search = createSearchInstance()
      const results = search.search('author:"Palette"')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).not.toContain('ColorSystem')
    })

    it('returns partial matches when using platform:windows', () => {
      const search = createSearchInstance()
      const results = search.search('platform:windows')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).toContain('ColorSystem')
    })

    it('returns the exact platform match when using platform:"windows"', () => {
      const search = createSearchInstance()
      const results = search.search('platform:"windows"')
      const names = results.map(entry => entry.name)
      expect(names).toContain('ColorPalette')
      expect(names).not.toContain('ColorSystem')
    })
  })
})
