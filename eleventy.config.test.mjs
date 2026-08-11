import { describe, expect, it } from 'vitest'
import { basePackage, installHistoryFor, installPeriod } from './eleventy.config.mjs'

describe('installHistoryFor', () => {
  it('provides compact metadata for browser-rendered cards', () => {
    expect(installHistoryFor(['2025-W06', '2025-W05'])).toEqual({
      window_start: 1_737_936_000,
      older_period: 'recorded since January 2025 (2 weeks)',
    })
  })
})

describe('installPeriod', () => {
  it('describes packages added during retained history as lifetime counts', () => {
    expect(installPeriod('2025-02-03T12:00:00Z', ['2025-W06', '2025-W05']))
      .toBe('since added to Package Control')
  })

  it('describes an incomplete global history window', () => {
    expect(installPeriod('2020-01-01T00:00:00Z', ['2025-W06', '2025-W05']))
      .toBe('recorded since January 2025 (2 weeks)')
  })

  it('describes 156 completed weeks as a three-year window', () => {
    expect(installPeriod('2020-01-01T00:00:00Z', Array(156).fill('2023-W01')))
      .toBe('in the past 3 years')
  })
})

describe('basePackage compatibility labels', () => {
  it('does not infer ST labels for skeleton tombstones', () => {
    const pkg = basePackage({
      name: 'Yollama',
      labels: ['auto-complete', 'ai', 'assistant'],
      first_seen: '2024-02-19T21:02:58Z',
      removed: '2025-11-16T12:38:48Z',
    })

    expect(pkg.labels).toEqual(['RIP', 'auto-complete', 'ai', 'assistant'])
    expect(pkg.compatibility).toBeNull()
    expect(pkg.outdated).toBe(false)
  })

  it('derives ST2 labels and flags from compatibility', () => {
    const pkg = basePackage({
      name: 'Old Package',
      releases: [
        { version: '1.0.0', sublime_text: '<3000', platforms: ['*'] },
      ],
    })

    expect(pkg.labels).toEqual(['ST2'])
    expect(pkg.compatibility).toBe('st2')
    expect(pkg.outdated).toBe(true)
  })

  it('derives ST3 labels and flags from compatibility', () => {
    const pkg = basePackage({
      name: 'ST3 Package',
      releases: [
        { version: '1.0.0', sublime_text: '3000-3999', platforms: ['*'] },
      ],
    })

    expect(pkg.labels).toEqual(['ST3'])
    expect(pkg.compatibility).toBe('st3')
    expect(pkg.outdated).toBe(false)
  })
})
