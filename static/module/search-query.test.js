import { describe, expect, it } from 'vitest'

import {
  appendFilterToken,
  buildFeaturedLabels,
  buildLabelRecords,
  extractActiveLabelValues,
  hasFilterValue,
  parseSingleFilterQuery,
  removeFilterValue,
} from './search-query.js'

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

  const records = buildLabelRecords([
    { labels: 'python,snippets,linting,theme,FAILING' },
    { labels: 'python,snippets,color scheme' },
    { labels: 'python,linting,theme' },
    { labels: 'python,snippets,language syntax' },
    { labels: 'go,snippets' },
  ])

  it('returns curated defaults when there are no active labels', () => {
    expect(buildFeaturedLabels('', records, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: defaults,
      activeLabels: [],
    })
  })

  it('returns active labels plus most-used co-occurring suggestions', () => {
    expect(buildFeaturedLabels('label:"python"', records, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: ['python', 'snippets', 'linting', 'theme', 'color scheme', 'language syntax'],
      activeLabels: ['python'],
    })
  })

  it('uses AND semantics for multiple active labels', () => {
    expect(
      buildFeaturedLabels('label:"python" label:"snippets"', records, {
        defaults,
        maxTotal: 6,
        excludedLabels: excluded,
      }),
    ).toEqual({
      labels: ['python', 'snippets', 'color scheme', 'language syntax', 'linting', 'theme'],
      activeLabels: ['python', 'snippets'],
    })
  })

  it('shows all active labels even when they exceed maxTotal', () => {
    const query = 'label:"a" label:"b" label:"c" label:"d" label:"e" label:"f" label:"g"'
    expect(buildFeaturedLabels(query, records, { defaults, maxTotal: 6, excludedLabels: excluded })).toEqual({
      labels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      activeLabels: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    })
  })
})
