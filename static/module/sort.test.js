import { describe, expect, it } from 'vitest'

import { Sort } from './sort.js'

describe('Sort installation modes', () => {
  const packages = [
    { name: 'Legacy', installs_total: 1_000, installs_recent: 10 },
    { name: 'Trending', installs_total: 100, installs_recent: 50 },
  ]

  it('sorts all-time installs by the overall total', () => {
    expect(Sort.sort(packages, 'installed').map(pkg => pkg.name))
      .toEqual(['Legacy', 'Trending'])
  })

  it('sorts recent installs by the retained window', () => {
    expect(Sort.sort(packages, 'installed-recent').map(pkg => pkg.name))
      .toEqual(['Trending', 'Legacy'])
  })
})
