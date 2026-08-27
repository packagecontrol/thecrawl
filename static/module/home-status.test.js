import { describe, expect, it } from 'vitest'

import {
  homeStatusForEntry,
  homeStatusPeriods,
} from './home-status.js'

describe('homepage status helpers', () => {
  it('uses green for successful runs with only expected failures', () => {
    const notes = [
      '#### Currently failing',
      '- **Private repository** [since now]',
      '  403 Forbidden',
      '- **Deleted repository** [since yesterday]',
      '  fatal: 404 Could not resolve to a Repository',
    ].join('\n')

    expect(homeStatusForEntry({ conclusion: 'success', notes })).toBe('okay')
  })

  it('uses orange for 5xx and unknown package failures', () => {
    const serverError = [
      '#### Currently failing',
      '- **Gateway trouble** [since now]',
      '  502 Bad Gateway',
    ].join('\n')
    const unknownError = [
      '#### Currently failing',
      '- **SwapStrings** [since now]',
      '  Unhandled exception: ClientOSError: Broken pipe',
    ].join('\n')

    expect(homeStatusForEntry({ conclusion: 'success', notes: serverError })).toBe('warning')
    expect(homeStatusForEntry({ conclusion: 'success', notes: unknownError })).toBe('warning')
  })

  it('uses red for failed runs even when their notes contain a warning', () => {
    const notes = '#### Currently failing\n- **Package**\n  503 Service Unavailable'

    expect(homeStatusForEntry({ conclusion: 'failure', notes })).toBe('error')
    expect(homeStatusForEntry({ conclusion: 'timed_out', notes: '' })).toBe('error')
  })

  it('orders periods earliest-first and sizes each to the next run', () => {
    const periods = homeStatusPeriods([
      { id: 'latest', date: '2026-08-14T03:00:00Z' },
      { id: 'earliest', date: '2026-08-14T00:00:00Z' },
      { id: 'middle', date: '2026-08-14T01:00:00Z' },
    ])

    expect(periods.map(period => period.entry.id)).toEqual([
      'earliest',
      'middle',
      'latest',
    ])
    expect(periods.map(period => period.duration)).toEqual([
      60 * 60 * 1000,
      2 * 60 * 60 * 1000,
      1.5 * 60 * 60 * 1000,
    ])
  })

  it('ignores entries without valid dates', () => {
    expect(homeStatusPeriods([
      { id: 'invalid', date: 'not-a-date' },
      { id: 'valid', date: '2026-08-14T00:00:00Z' },
    ])).toEqual([
      {
        entry: { id: 'valid', date: '2026-08-14T00:00:00Z' },
        timestamp: Date.parse('2026-08-14T00:00:00Z'),
        duration: 1,
      },
    ])
  })
})
