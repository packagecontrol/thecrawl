import { describe, expect, it } from 'vitest'

import {
  appendFilterToken,
  buildFeaturedLabels,
  buildLabelRecords,
  extractActiveLabelValues,
  hasFilterValue,
  parseQueryParts,
  parseSingleFilterQuery,
  removeFilterValue,
} from './search-query.js'

describe('parseQueryParts', () => {
  it('parses supported filters and free-text spans', () => {
    const query = 'react author:dan label:"starter kit" platform:web'

    expect(parseQueryParts(query)).toEqual([
      {
        kind: 'text',
        value: 'react ',
        start: 0,
        end: query.indexOf('author:dan'),
      },
      {
        kind: 'filter',
        type: 'author',
        token: 'author:dan',
        value: 'dan',
        quoted: false,
        start: query.indexOf('author:dan'),
        end: query.indexOf('author:dan') + 'author:dan'.length,
      },
      {
        kind: 'filter',
        type: 'label',
        token: 'label:"starter kit"',
        value: 'starter kit',
        quoted: true,
        start: query.indexOf('label:"starter kit"'),
        end: query.indexOf('label:"starter kit"') + 'label:"starter kit"'.length,
      },
      {
        kind: 'filter',
        type: 'platform',
        token: 'platform:web',
        value: 'web',
        quoted: false,
        start: query.indexOf('platform:web'),
        end: query.indexOf('platform:web') + 'platform:web'.length,
      },
    ])
  })

  it('keeps unsupported filters in free text', () => {
    const query = 'status:active label:theme'

    expect(parseQueryParts(query)).toEqual([
      {
        kind: 'text',
        value: 'status:active ',
        start: 0,
        end: query.indexOf('label:theme'),
      },
      {
        kind: 'filter',
        type: 'label',
        token: 'label:theme',
        value: 'theme',
        quoted: false,
        start: query.indexOf('label:theme'),
        end: query.length,
      },
    ])
  })

  it('distinguishes exact quoted filters from prefix quoted filters', () => {
    const query = 'label:"full phrase" label:"prefix'

    expect(parseQueryParts(query)).toEqual([
      {
        kind: 'filter',
        type: 'label',
        token: 'label:"full phrase"',
        value: 'full phrase',
        quoted: true,
        start: 0,
        end: 'label:"full phrase"'.length,
      },
      {
        kind: 'filter',
        type: 'label',
        token: 'label:"prefix',
        value: 'prefix',
        quoted: false,
        start: query.indexOf('label:"prefix'),
        end: query.length,
      },
    ])
  })
})

describe('parseSingleFilterQuery', () => {
  it('parses a single filter token', () => {
    expect(parseSingleFilterQuery('label:"python"')).toEqual({
      type: 'label',
      token: 'label:"python"',
      value: 'python',
    })
    expect(parseSingleFilterQuery('platform:windows')).toEqual({
      type: 'platform',
      token: 'platform:windows',
      value: 'windows',
    })
  })

  it('returns null when query contains extra text', () => {
    expect(parseSingleFilterQuery('label:"python" snippets')).toBeNull()
  })
})

describe('filter token toggling helpers', () => {
  it('detects, removes and appends tokens', () => {
    const current = 'foo label:"python" label:"linting"'
    expect(hasFilterValue(current, 'label', 'python')).toBe(true)

    const removed = removeFilterValue(current, 'label', 'python')
    expect(removed).toBe('foo label:"linting"')
    expect(hasFilterValue(removed, 'label', 'python')).toBe(false)

    const appended = appendFilterToken(removed, 'label:"theme"')
    expect(appended).toBe('foo label:"linting" label:"theme"')
  })
})

describe('extractActiveLabelValues', () => {
  it('dedupes labels while preserving first-seen order', () => {
    expect(extractActiveLabelValues('label:"Python" label:"python" label:"Linting"')).toEqual([
      'Python',
      'Linting',
    ])
  })
})

describe('buildFeaturedLabels', () => {
  const defaults = ['language syntax', 'snippets', 'linting', 'auto-complete', 'color scheme', 'theme']
  const excluded = ['ST2', 'ST3', 'MIA', 'RIP', 'FAILING']

  const allRecords = buildLabelRecords([
    { labels: 'python,snippets,linting,theme,FAILING' },
    { labels: 'python,snippets,color scheme' },
    { labels: 'python,linting,theme' },
    { labels: 'python,snippets,language syntax' },
    { labels: 'go,snippets' },
  ])

  const pythonScopedRecords = buildLabelRecords([
    { labels: 'python,snippets,linting,theme,FAILING' },
    { labels: 'python,snippets,color scheme' },
    { labels: 'python,linting,theme' },
    { labels: 'python,snippets,language syntax' },
  ])

  it('returns curated defaults when there is no query', () => {
    expect(buildFeaturedLabels('', allRecords, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: defaults,
      activeLabels: [],
    })
  })

  it('omits free-text query terms from featured labels', () => {
    expect(buildFeaturedLabels('python', pythonScopedRecords, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: ['snippets', 'linting', 'theme', 'color scheme', 'language syntax'],
      activeLabels: [],
    })
  })

  it('keeps active labels while omitting unrelated free-text terms', () => {
    expect(buildFeaturedLabels('label:"python" snippets', pythonScopedRecords, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: ['python', 'linting', 'theme', 'color scheme', 'language syntax'],
      activeLabels: ['python'],
    })
  })

  it('falls back to defaults when a non-empty query has no suggestions', () => {
    expect(buildFeaturedLabels('nope', [], { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: defaults,
      activeLabels: [],
    })
  })

  it('shows all active labels even when they exceed maxTotal', () => {
    const query = 'label:"a" label:"b" label:"c" label:"d" label:"e" label:"f" label:"g"'
    expect(buildFeaturedLabels(query, allRecords, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      activeLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
  })
})
