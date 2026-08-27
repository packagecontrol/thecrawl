/**
 * @template {{ date?: string }} T
 * @typedef {{
 *   nowTimestamp?: number,
 * }} DayWindowOptions
 */

/**
 * @template {{ date?: string }} T
 * @param {T[]} entries
 * @param {number} days
 * @param {DayWindowOptions} [options]
 * @returns {T[]}
 */
export function filterEntriesToDayWindow(entries, days, {
  nowTimestamp = Date.now(),
} = {}) {
  const maxDays = Math.max(0, Math.floor(days))
  const anchorDayId = localDayId(nowTimestamp)

  const filtered = []
  for (const entry of entries) {
    const diffDays = dayIndexForTimestamp(safeDate(entry.date), anchorDayId)
    if (diffDays >= 0 && diffDays < maxDays) {
      filtered.push(entry)
    }
  }

  return filtered
}

/**
 * @param {string | undefined} value
 * @returns {number}
 */
export function safeDate(value) {
  const timestamp = value ? Date.parse(value) : NaN
  return Number.isFinite(timestamp) ? timestamp : 0
}

/**
 * @param {number} timestamp
 * @param {number} dayOffset
 * @returns {number}
 */
export function shiftTimestampByLocalDays(timestamp, dayOffset) {
  const shifted = new Date(timestamp)
  shifted.setDate(shifted.getDate() + dayOffset)
  return shifted.getTime()
}

/**
 * @param {number} leftTimestamp
 * @param {number} rightTimestamp
 * @returns {boolean}
 */
export function sameLocalDay(leftTimestamp, rightTimestamp) {
  return localDayId(leftTimestamp) === localDayId(rightTimestamp)
}

/**
 * @param {number} timestamp
 * @param {number} anchorDayId
 * @returns {number}
 */
export function dayIndexForTimestamp(timestamp, anchorDayId) {
  return anchorDayId - localDayId(timestamp)
}

/**
 * @param {number} laterTimestamp
 * @param {number} earlierTimestamp
 * @returns {number}
 */
export function localDayDistance(laterTimestamp, earlierTimestamp) {
  return localDayId(laterTimestamp) - localDayId(earlierTimestamp)
}

/**
 * @param {number} timestamp
 * @returns {number}
 */
export function localDayId(timestamp) {
  const d = new Date(timestamp)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / (24 * 60 * 60 * 1000))
}

/**
 * @param {number} timestamp
 * @returns {string}
 */
export function localDayKey(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
