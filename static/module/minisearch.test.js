import MiniSearch from 'minisearch'
import { beforeAll, describe, expect, it } from 'vitest'

import { createMinisearch } from './minisearch.js'

describe('GitSavvy search', () => {
  const data = [
    {
      name: 'GitSavvy',
      description: 'Git helper',
      author: 'CJ',
      platforms: ['linux'],
      labels: ['git'],
    },
    {
      name: 'AlpineJS',
      description: 'Lightweight JS framework',
      author: 'Alpine Team',
      platforms: ['linux'],
      labels: ['javascript'],
    },
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
  ]

  let minisrch

  beforeAll(() => {
    minisrch = createMinisearch(MiniSearch, data)
  })

  it.each([
    { query: 'git' },
    { query: 'savvy' },
    { query: 'gitsavvy' },
    { query: 'git savvy' },
  ])('returns GitSavvy for $query', ({ query }) => {
    const results = minisrch.search(query)
    expect(results.some(entry => entry.name === 'GitSavvy')).toBe(true)
  })

  it.each([
    { query: 'js' },
    { query: 'JS' },
    { query: 'AlpineJS' },
    { query: 'alpinejs' },
  ])('returns AlpineJS for $query', ({ query }) => {
    const results = minisrch.search(query)
    expect(results.some(entry => entry.name === 'AlpineJS')).toBe(true)
  })

  it.each([
    { query: 'colour' },
    { query: 'color' },
  ])('returns both ColourHelper and ColorHelper for $query', ({ query }) => {
    const results = minisrch.search(query)
    const names = results.map(entry => entry.name)
    expect(names).toContain('ColourHelper')
    expect(names).toContain('ColorHelper')
  })
})
