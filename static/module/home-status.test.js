import { describe, expect, it } from 'vitest'

import {
  homeStatusDurationStops,
  homeStatusForEntry,
  homeStatusPeriods,
  homeStatusView,
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

  it('builds the shared server and client ribbon view', () => {
    const view = homeStatusView([
      {
        run_id: 'failed',
        date: '2026-08-14T05:00:00Z',
        conclusion: 'failure',
      },
      {
        run_id: 'okay',
        date: '2026-08-14T00:00:00Z',
        conclusion: 'success',
      },
      {
        run_id: 'warning',
        date: '2026-08-14T01:00:00Z',
        conclusion: 'success',
        notes: '#### Currently failing\n- **Package**\n  500 Server Error',
      },
    ])

    expect(view.counts).toEqual({ okay: 1, warning: 1, error: 1 })
    expect(view.segments).toEqual([
      {
        key: 'okay',
        date: '– 2026-08-14 –',
        className: 'home-status-segment is-okay',
        style: 'flex-grow: 3600000',
        status: 'okay',
      },
      {
        key: 'warning',
        date: '– 2026-08-14 –',
        className: 'home-status-segment is-warning has-duration-warning has-duration-error',
        style: 'flex-grow: 14400000; --duration-warning-stop: 50%; --duration-error-stop: 75%',
        status: 'warning',
      },
      {
        key: 'failed',
        date: '– 2026-08-14 –',
        className: 'home-status-segment is-error has-duration-warning',
        style: 'flex-grow: 9000000; --duration-warning-stop: 80%',
        status: 'error',
      },
    ])
    expect(view.label).toContain('1 okay, 1 warnings, and 1 errors.')
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

  it('marks two-hour warnings and three-hour errors within periods', () => {
    const hour = 60 * 60 * 1000

    expect(homeStatusDurationStops(2 * hour)).toBeNull()
    expect(homeStatusDurationStops(2.5 * hour)).toEqual({
      warning: 80,
      error: null,
    })
    expect(homeStatusDurationStops(3 * hour)).toEqual({
      warning: (2 / 3) * 100,
      error: null,
    })
    expect(homeStatusDurationStops(4 * hour)).toEqual({
      warning: 50,
      error: 75,
    })
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
