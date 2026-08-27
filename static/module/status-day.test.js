import { describe, expect, it } from 'vitest'

import {
  dayIndexForTimestamp,
  filterEntriesToDayWindow,
  localDayDistance,
  localDayId,
  localDayKey,
  sameLocalDay,
  shiftTimestampByLocalDays,
} from './status-day.js'

describe('status-day helpers', () => {
  it('maps timestamps from the same local date to the same day id', () => {
    const morning = new Date(2026, 2, 30, 1, 15, 0, 0).getTime()
    const evening = new Date(2026, 2, 30, 23, 45, 0, 0).getTime()

    expect(localDayId(morning)).toBe(localDayId(evening))
    expect(localDayKey(morning)).toBe(localDayKey(evening))
    expect(sameLocalDay(morning, evening)).toBe(true)
  })

  it('computes local day distance by calendar day, not by fixed 24h chunks', () => {
    const todayNoon = new Date(2026, 2, 30, 12, 0, 0, 0).getTime()
    const yesterdayLate = new Date(2026, 2, 29, 23, 0, 0, 0).getTime()

    expect(localDayDistance(todayNoon, yesterdayLate)).toBe(1)
  })

  it('shifts timestamps by local calendar days', () => {
    const source = new Date(2026, 2, 30, 8, 30, 0, 0).getTime()
    const shifted = shiftTimestampByLocalDays(source, -2)

    expect(sameLocalDay(shifted, new Date(2026, 2, 28, 8, 30, 0, 0).getTime())).toBe(true)
  })

  it('filters entries to a local day window', () => {
    const nowTimestamp = new Date(2026, 2, 30, 12, 0, 0, 0).getTime()
    const entries = [
      { id: 'today', date: new Date(2026, 2, 30, 6, 0, 0, 0).toISOString() },
      { id: 'yesterday', date: new Date(2026, 2, 29, 21, 0, 0, 0).toISOString() },
      { id: 'older', date: new Date(2026, 1, 28, 12, 0, 0, 0).toISOString() },
      { id: 'future', date: new Date(2026, 2, 31, 12, 0, 0, 0).toISOString() },
    ]

    const filtered = filterEntriesToDayWindow(entries, 30, { nowTimestamp })

    expect(filtered.map(entry => entry.id)).toEqual(['today', 'yesterday'])
  })

  it('returns day indexes relative to an anchor day id', () => {
    const anchor = localDayId(new Date(2026, 2, 30, 12, 0, 0, 0).getTime())

    expect(dayIndexForTimestamp(new Date(2026, 2, 30, 1, 0, 0, 0).getTime(), anchor)).toBe(0)
    expect(dayIndexForTimestamp(new Date(2026, 2, 29, 23, 0, 0, 0).getTime(), anchor)).toBe(1)
    expect(dayIndexForTimestamp(new Date(2026, 2, 31, 1, 0, 0, 0).getTime(), anchor)).toBe(-1)
  })

  it('avoids the 23-hour DST bucket-collapse bug when local timezone has one', () => {
    // This test is runtime-timezone dependent. We search nearby years for
    // any local day that is 23 hours long (spring-forward DST day).
    const shortDay = findDayBoundaryWithHourLength(23)
    if (!shortDay) {
      // Timezones without DST (or unusual rules) cannot reproduce this.
      expect(true).toBe(true)
      return
    }

    const todayNoon = new Date(shortDay.nextStart)
    todayNoon.setHours(12, 0, 0, 0)

    const yesterdayLate = new Date(shortDay.dayStart)
    yesterdayLate.setHours(23, 0, 0, 0)

    const nowTs = todayNoon.getTime()
    const ts = yesterdayLate.getTime()

    expect(localDayDistance(nowTs, ts)).toBe(1)
    expect(legacyFixed24hDistance(nowTs, ts)).toBe(0)
  })
})

/**
 * Find a local-calendar day with the requested hour span (e.g. 23h for
 * spring-forward DST). Returns the start of that day and the next day start,
 * or null when no such day exists in the searched range.
 *
 * @param {number} hours
 * @returns {{ dayStart: Date, nextStart: Date } | null}
 */
function findDayBoundaryWithHourLength(hours) {
  const currentYear = new Date().getFullYear()

  for (let year = currentYear - 3; year <= currentYear + 3; year += 1) {
    const start = new Date(year, 0, 1, 0, 0, 0, 0)

    for (let i = 0; i < 370; i += 1) {
      const dayStart = new Date(start)
      dayStart.setDate(dayStart.getDate() + i)
      dayStart.setHours(0, 0, 0, 0)

      const nextStart = new Date(dayStart)
      nextStart.setDate(nextStart.getDate() + 1)

      const spanHours = (nextStart.getTime() - dayStart.getTime()) / (60 * 60 * 1000)
      if (spanHours === hours) {
        return { dayStart, nextStart }
      }
    }
  }

  return null
}

/**
 * Historical reference implementation that used local-midnight deltas divided
 * by fixed 24h chunks. Around DST forward days this can collapse yesterday
 * into today (returns 0 instead of 1).
 *
 * @param {number} laterTimestamp
 * @param {number} earlierTimestamp
 * @returns {number}
 */
function legacyFixed24hDistance(laterTimestamp, earlierTimestamp) {
  const later = new Date(laterTimestamp)
  const laterDayStart = new Date(later.getFullYear(), later.getMonth(), later.getDate()).getTime()

  const earlier = new Date(earlierTimestamp)
  const earlierDayStart = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate()).getTime()

  return Math.floor((laterDayStart - earlierDayStart) / (24 * 60 * 60 * 1000))
}
