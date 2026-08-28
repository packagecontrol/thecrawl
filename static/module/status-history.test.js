import { describe, expect, it } from 'vitest'
import {
  parseCrawlHistory,
  resolvePackageRunState,
} from './status-history.js'

describe('parseCrawlHistory', () => {
  it('expands compact run indexes into lookup sets', () => {
    const history = parseCrawlHistory({
      runs: ['run-new', 'run-middle', 'run-old'],
      available: [0, 2],
      packages: {
        LSP: [0, 2],
        GitSavvy: [1],
      },
    })

    expect([...history.availableRunIds]).toEqual(['run-new', 'run-old'])
    expect([...history.packagesByName.get('lsp').touchedRunIds])
      .toEqual(['run-new', 'run-old'])
  })

  it('ignores malformed and out-of-range indexes', () => {
    const history = parseCrawlHistory({
      runs: ['run-1'],
      available: [-1, 0, 4, '0'],
      packages: { LSP: [0, 3, null] },
    })

    expect([...history.availableRunIds]).toEqual(['run-1'])
    expect([...history.packagesByName.get('lsp').touchedRunIds])
      .toEqual(['run-1'])
  })
})

describe('resolvePackageRunState', () => {
  const history = parseCrawlHistory({
    runs: ['1', '2'],
    available: [0, 1],
    packages: { 'Claude Sublime': [1] },
  })

  it('matches complete package names case-insensitively', () => {
    const state = resolvePackageRunState(history, '  claude   sublime ')

    expect(state.name).toBe('Claude Sublime')
    expect([...state.touchedRunIds]).toEqual(['2'])
  })

  it('does not reinterpret free-form notes searches as packages', () => {
    expect(resolvePackageRunState(history, 'Claude')).toBeNull()
    expect(resolvePackageRunState(history, '404')).toBeNull()
  })
})
