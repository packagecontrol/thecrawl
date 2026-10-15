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
    ], Date.parse('2026-08-14T07:30:00Z'))

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
        style: 'flex-grow: 14400000; --duration-warning-stop: 37.5%; --duration-error-stop: 50%',
        status: 'warning',
      },
      {
        key: 'failed',
        date: '– 2026-08-14 –',
        className: 'home-status-segment is-error',
        style: 'flex-grow: 9000000',
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
    ], Date.parse('2026-08-14T04:00:00Z'))

    expect(periods.map(period => period.entry.id)).toEqual([
      'earliest',
      'middle',
      'latest',
    ])
    expect(periods.map(period => period.duration)).toEqual([
      60 * 60 * 1000,
      2 * 60 * 60 * 1000,
      60 * 60 * 1000,
    ])
  })

  it('marks 1.5× warnings and 2× errors relative to the baseline', () => {
    const hour = 60 * 60 * 1000

    expect(homeStatusDurationStops(3 * hour, 2 * hour)).toBeNull()
    expect(homeStatusDurationStops(3.75 * hour, 2 * hour)).toEqual({
      warning: 80,
      error: null,
    })
    expect(homeStatusDurationStops(4 * hour, 2 * hour)).toEqual({
      warning: 75,
      error: null,
    })
    expect(homeStatusDurationStops(5 * hour, 2 * hour)).toEqual({
      warning: 60,
      error: 80,
    })
    expect(homeStatusDurationStops(5 * hour, 0)).toBeNull()
    expect(homeStatusDurationStops(Infinity, hour)).toBeNull()
    expect(homeStatusDurationStops(hour, NaN)).toBeNull()
  })

  it('uses only the preceding 30 completed intervals for each baseline', () => {
    const hour = 60 * 60 * 1000
    let timestamp = Date.parse('2026-08-01T00:00:00Z')
    const entries = [{ date: new Date(timestamp).toISOString() }]
    for (let i = 0; i < 60; i += 1) {
      timestamp += (i < 30 ? 4 : 1) * hour
      entries.push({ date: new Date(timestamp).toISOString() })
    }
    const periods = homeStatusPeriods(entries, timestamp + 10 * hour)

    expect(periods[0].baseline).toBe(0)
    expect(periods[1].baseline).toBe(4 * hour)
    expect(periods[30].baseline).toBe(4 * hour)
    expect(periods[45].baseline).toBe(2.5 * hour)
    expect(periods[46].baseline).toBe(hour)
    expect(periods.at(-1).baseline).toBe(hour)
    expect(periods.at(-1).duration).toBe(10 * hour)
    // Later runs must not change the earlier periods or their thresholds.
    expect(homeStatusPeriods(entries.slice(0, 31), timestamp)[29]).toEqual(periods[29])
  })

  it('ages the newest segment without changing its baseline', () => {
    const entries = [0, 4, 8].map(hour => ({
      date: new Date(Date.UTC(2026, 7, 14, hour)).toISOString(),
    }))
    const viewAt = hour => homeStatusView(entries, Date.UTC(2026, 7, 14, hour))

    expect(viewAt(9).segments.at(-1).className).toBe('home-status-segment is-okay')
    expect(viewAt(15).segments.at(-1).className).toContain('has-duration-warning')
    expect(viewAt(15).segments.at(-1).className).not.toContain('has-duration-error')
    expect(viewAt(17).segments.at(-1).className).toContain('has-duration-error')
    expect(viewAt(17).segments.slice(0, -1)).toEqual(viewAt(9).segments.slice(0, -1))
  })

  it('ignores duplicate timestamps in the baseline and clamps future periods', () => {
    const entries = [0, 0, 4].map(hour => ({
      date: new Date(Date.UTC(2026, 7, 14, hour)).toISOString(),
    }))
    const periods = homeStatusPeriods(entries, Date.UTC(2026, 7, 14, 3))
    expect(periods.map(period => period.baseline)).toEqual([0, 0, 4 * 60 * 60 * 1000])
    expect(periods[0].duration).toBe(1)
    expect(periods.at(-1).duration).toBe(1)
  })

  it('ignores entries without valid dates', () => {
    expect(homeStatusPeriods([
      { id: 'invalid', date: 'not-a-date' },
      { id: 'valid', date: '2026-08-14T00:00:00Z' },
    ], Date.parse('2026-08-14T00:00:00Z'))).toEqual([
      {
        entry: { id: 'valid', date: '2026-08-14T00:00:00Z' },
        timestamp: Date.parse('2026-08-14T00:00:00Z'),
        duration: 1,
        baseline: 0,
      },
    ])
  })
})
