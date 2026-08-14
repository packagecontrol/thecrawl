import { describe, expect, it } from 'vitest'
import {
  basePackage,
  installHistoryFor,
  installPeriod,
  packageSuccessionMetadata,
} from './eleventy.config.mjs'

describe('packageSuccessionMetadata', () => {
  const packages = [
    {
      name: 'Old Name',
      first_seen: '2016-01-05T00:33:04Z',
      removed: '2026-08-02T18:31:58Z',
    },
    {
      name: 'New Name',
      first_seen: '2026-08-02T18:31:51Z',
      previous_names: ['Old Name'],
    },
  ]

  it('links both ends of a recent rename with a matching tombstone', () => {
    const metadata = packageSuccessionMetadata(packages, Date.parse('2026-08-12T00:00:00Z'))

    expect(metadata.get('Old Name')).toEqual({ successor_name: 'New Name' })
    expect(metadata.get('New Name')).toEqual({
      predecessors: [{ name: 'Old Name', has_tombstone: true }],
    })
  })

  it('keeps the tombstone link but expires the successor notice after a year', () => {
    const metadata = packageSuccessionMetadata(packages, Date.parse('2027-08-12T00:00:00Z'))

    expect(metadata.get('Old Name')).toEqual({ successor_name: 'New Name' })
    expect(metadata.has('New Name')).toBe(false)
  })

  it('shows an unlinked predecessor without a matching tombstone', () => {
    const metadata = packageSuccessionMetadata([{
      name: 'New Name',
      first_seen: '2026-08-02T18:31:51Z',
      previous_names: ['Missing Name'],
    }], Date.parse('2026-08-12T00:00:00Z'))

    expect(metadata.get('Missing Name')).toEqual({ successor_name: 'New Name' })
    expect(metadata.get('New Name')).toEqual({
      predecessors: [{ name: 'Missing Name', has_tombstone: false }],
    })
  })
})

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
