import MiniSearch from 'minisearch'
import { beforeAll, describe, expect, it } from 'vitest'

import { createMinisearch, customTokenizer } from './minisearch.js'

describe('MiniSearch.search', () => {
  const createSearch = packages => createMinisearch(MiniSearch, packages)

  it.each([
    { query: 'git' },
    { query: 'savvy' },
    { query: 'gitsavvy' },
    { query: 'git savvy' },
  ])('returns GitSavvy for $query', ({ query }) => {
    const minisrch = createSearch([
      {
        name: 'GitSavvy',
        description: 'Git helper',
        author: 'CJ',
        platforms: ['linux'],
        labels: ['git'],
      },
    ])
    const results = minisrch.search(query)
    expect(results.some(entry => entry.name === 'GitSavvy')).toBe(true)
  })

  it.each([
    { query: 'js' },
    { query: 'JS' },
    { query: 'AlpineJS' },
    { query: 'alpinejs' },
  ])('returns AlpineJS for $query', ({ query }) => {
    const minisrch = createSearch([
      {
        name: 'AlpineJS',
        description: 'Lightweight JS framework',
        author: 'Alpine Team',
        platforms: ['linux'],
        labels: ['javascript'],
      },
    ])
    const results = minisrch.search(query)
    expect(results.some(entry => entry.name === 'AlpineJS')).toBe(true)
  })

  it.each([
    { query: 'colour' },
    { query: 'color' },
  ])('returns both ColourHelper and ColorHelper for $query', ({ query }) => {
    const minisrch = createSearch([
      {
        name: 'ColourHelper',
        description: 'Helps with colour conversions',
        author: 'Colour Co',
        platforms: ['linux'],
        labels: ['colour'],
      },
      {
        name: 'ColorHelper',
        description: 'Helps with color conversions',
        author: 'Color Co',
        platforms: ['linux'],
        labels: ['color'],
      },
    ])
    const results = minisrch.search(query)
    const names = results.map(entry => entry.name)
    expect(names).toContain('ColourHelper')
    expect(names).toContain('ColorHelper')
  })

  it.each([
    { query: 'localisation' },
    { query: 'localization' },
  ])('returns both LocalisationHelper and LocalizationHelper for $query', ({ query }) => {
    const minisrch = createSearch([
      {
        name: 'LocalisationHelper',
        description: 'Handles localisation workflows',
        author: 'Locale Co',
        platforms: ['linux'],
        labels: ['localisation'],
      },
      {
        name: 'LocalizationHelper',
        description: 'Handles localization workflows',
        author: 'Locale Co',
        platforms: ['linux'],
        labels: ['localization'],
      },
    ])
    const results = minisrch.search(query)
    const names = results.map(entry => entry.name)
    expect(names).toContain('LocalisationHelper')
    expect(names).toContain('LocalizationHelper')
  })

  it.each([
    { query: 'internationalisation' },
    { query: 'internationalization' },
  ])('returns both InternationalisationSuite and InternationalizationSuite for $query', ({ query }) => {
    const minisrch = createSearch([
      {
        name: 'InternationalisationSuite',
        description: 'Supports internationalisation efforts',
        author: 'Global Co',
        platforms: ['linux'],
        labels: ['internationalisation'],
      },
      {
        name: 'InternationalizationSuite',
        description: 'Supports internationalization efforts',
        author: 'Global Co',
        platforms: ['linux'],
        labels: ['internationalization'],
      },
    ])
    const results = minisrch.search(query)
    const names = results.map(entry => entry.name)
    expect(names).toContain('InternationalisationSuite')
    expect(names).toContain('InternationalizationSuite')
  })

  describe('Chinese search', () => {
    let minisrch

    const chinesePackages = [
      {
        name: '中文工具',
        description: 'Chinese tooling',
        author: '汉语',
        platforms: ['linux'],
        labels: ['国际化'],
      },
    ]

    beforeAll(() => {
      minisrch = createSearch(chinesePackages)
    })

    it('tokenizes Unicode terms such as Chinese characters', () => {
      const tokens = customTokenizer('中文 test')
      expect(tokens).toEqual(expect.arrayContaining(['中文']))
    })

    it('returns Chinese packages when searching with Chinese characters', () => {
      const results = minisrch.search('中文')
      const names = results.map(entry => entry.name)
      expect(names).toContain('中文工具')
    })
  })
})
