import { dayIndexForTimestamp, localDayId, safeDate } from './status-day.js'

/**
 * Find the newest release tag that is older than the chart's visible day
 * window. This lets the chart render an overflow pointer based on the
 * viewer's current date instead of a build-time cutoff.
 *
 * @template {{ date?: string }} T
 * @param {T[]} markers
 * @param {number} days
 * @param {{ nowTimestamp?: number }} [options]
 * @returns {T | null}
 */
export function newestTagBeforeDayWindow(markers, days, {
  nowTimestamp = Date.now(),
} = {}) {
  const maxDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0
  const anchorDayId = localDayId(nowTimestamp)
  let newest = null
  let newestTimestamp = 0

  for (const marker of markers || []) {
    const ts = safeDate(marker?.date)
    if (!ts) continue

    const dayIndex = dayIndexForTimestamp(ts, anchorDayId)
    if (!Number.isFinite(dayIndex) || dayIndex < maxDays) continue

    if (!newest || ts > newestTimestamp) {
      newest = marker
      newestTimestamp = ts
    }
  }

  return newest
}
