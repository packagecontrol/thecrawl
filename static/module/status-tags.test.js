import { describe, expect, it } from 'vitest'
import { newestTagBeforeDayWindow } from './status-tags.js'
import { shiftTimestampByLocalDays } from './status-day.js'

function isoDaysBefore(now, daysAgo) {
  return new Date(shiftTimestampByLocalDays(now, -daysAgo)).toISOString()
}

describe('status tag helpers', () => {
  it('finds the newest tag before the visible chart window', () => {
    const now = Date.parse('2026-04-30T12:00:00Z')
    const marker = newestTagBeforeDayWindow([
      { tag: '0.13.1', date: isoDaysBefore(now, 35) },
      { tag: '0.14.0', date: isoDaysBefore(now, 30) },
      { tag: '0.15.0', date: isoDaysBefore(now, 10) },
    ], 30, { nowTimestamp: now })

    expect(marker?.tag).toBe('0.14.0')
  })

  it('returns null when all tags are inside the visible chart window', () => {
    const now = Date.parse('2026-04-30T12:00:00Z')
    const marker = newestTagBeforeDayWindow([
      { tag: '0.15.0', date: isoDaysBefore(now, 0) },
      { tag: '0.14.0', date: isoDaysBefore(now, 29) },
    ], 30, { nowTimestamp: now })

    expect(marker).toBeNull()
  })

  it('ignores invalid and future marker dates', () => {
    const now = Date.parse('2026-04-30T12:00:00Z')
    const marker = newestTagBeforeDayWindow([
      { tag: 'bad', date: 'nope' },
      { tag: 'future', date: isoDaysBefore(now, -1) },
      { tag: 'old', date: isoDaysBefore(now, 31) },
    ], 30, { nowTimestamp: now })

    expect(marker?.tag).toBe('old')
  })
})
