import { extractCurrentlyFailingBlocks } from './status-failing.js'

const ERROR_CONCLUSIONS = new Set([
  'failure',
  'failed',
  'cancelled',
  'timed_out',
])

/**
 * Map a crawler entry to one of the landing-page ribbon states.
 *
 * Workflow errors take precedence over warnings. Successful runs are warnings
 * when a currently-failing package has something other than the expected 403
 * and 404 responses.
 *
 * @param {{ conclusion?: string, notes?: string }} entry
 * @returns {'okay' | 'warning' | 'error'}
 */
export function homeStatusForEntry(entry) {
  const conclusion = String(entry?.conclusion || '').toLowerCase()
  if (ERROR_CONCLUSIONS.has(conclusion)) return 'error'
  if (hasUnexpectedPackageFailure(entry?.notes)) return 'warning'
  return 'okay'
}

/**
 * Turn newest- or oldest-first log data into oldest-first ribbon periods.
 * The newest run has no following timestamp, so it receives the median period
 * duration. This keeps its state visible at the right edge of the ribbon.
 *
 * @template {{ date?: string }} T
 * @param {T[]} entries
 * @returns {{ entry: T, timestamp: number, duration: number }[]}
 */
export function homeStatusPeriods(entries) {
  const datedEntries = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, timestamp: Date.parse(entry?.date || '') }))
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)

  if (!datedEntries.length) return []
  if (datedEntries.length === 1) {
    return [{ ...datedEntries[0], duration: 1 }]
  }

  const gaps = []
  for (let i = 0; i < datedEntries.length - 1; i += 1) {
    const gap = datedEntries[i + 1].timestamp - datedEntries[i].timestamp
    if (gap > 0) gaps.push(gap)
  }
  const finalDuration = median(gaps) || 1

  return datedEntries.map((item, index) => {
    const nextTimestamp = datedEntries[index + 1]?.timestamp
    const duration = nextTimestamp > item.timestamp
      ? nextTimestamp - item.timestamp
      : finalDuration
    return { ...item, duration }
  })
}

function hasUnexpectedPackageFailure(notes) {
  const blocks = extractCurrentlyFailingBlocks(notes || '')
  return blocks.some((block) => {
    const firstDetail = block.signature.split('\n')[1] || ''
    return !/\b(?:403|404)\b/.test(firstDetail)
  })
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[middle]
  return (sorted[middle - 1] + sorted[middle]) / 2
}
