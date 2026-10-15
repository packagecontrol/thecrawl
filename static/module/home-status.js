import { extractCurrentlyFailingBlocks } from './status-failing.js'

const ERROR_CONCLUSIONS = new Set([
  'failure',
  'failed',
  'cancelled',
  'timed_out',
])

/**
 * Build the shared view model used to render the landing-page ribbon during
 * the Eleventy build and during client-side data refreshes.
 *
 * @param {object[]} entries
 * @returns {{
 *   segments: {
 *     key: string,
 *     date: string,
 *     className: string,
 *     style: string,
 *     status: 'okay' | 'warning' | 'error',
 *   }[],
 *   counts: { okay: number, warning: number, error: number },
 *   label: string,
 * }}
 */
export function homeStatusView(entries, now = Date.now()) {
  const periods = homeStatusPeriods(entries, now)
  const counts = { okay: 0, warning: 0, error: 0 }
  const segments = periods.map((period) => {
    const status = homeStatusForEntry(period.entry)
    const stops = homeStatusDurationStops(period.duration, period.baseline)
    const classNames = ['home-status-segment', `is-${status}`]
    const styles = [`flex-grow: ${period.duration}`]
    counts[status] += 1

    if (stops) {
      classNames.push('has-duration-warning')
      styles.push(`--duration-warning-stop: ${stops.warning}%`)
    }
    if (stops?.error !== null && stops?.error !== undefined) {
      classNames.push('has-duration-error')
      styles.push(`--duration-error-stop: ${stops.error}%`)
    }

    return {
      key: String(period.entry?.run_id || period.timestamp),
      date: formatRibbonDate(period.entry?.date),
      className: classNames.join(' '),
      style: styles.join('; '),
      status,
    }
  })

  return {
    segments,
    counts,
    label: periods.length ? ribbonLabel(periods, counts) : '',
  }
}

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
 * Each baseline uses up to 30 positive, completed intervals preceding the run.
 * The newest period extends to now; it never contributes to its own baseline.
 *
 * @template {{ date?: string }} T
 * @param {T[]} entries
 * @param {number} now
 * @returns {{ entry: T, timestamp: number, duration: number, baseline: number }[]}
 */
export function homeStatusPeriods(entries, now = Date.now()) {
  const datedEntries = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ entry, timestamp: Date.parse(entry?.date || '') }))
    .filter(item => Number.isFinite(item.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)

  if (!datedEntries.length) return []
  const gaps = []
  return datedEntries.map((item, index) => {
    const previousTimestamp = datedEntries[index - 1]?.timestamp
    const gap = item.timestamp - previousTimestamp
    if (gap > 0) {
      gaps.push(gap)
      if (gaps.length > 30) gaps.shift()
    }
    const baseline = median(gaps)
    const end = datedEntries[index + 1]?.timestamp ?? now
    const duration = Math.max(1, end - item.timestamp)
    return { ...item, duration, baseline }
  })
}

/**
 * Locate warning (1.5× median) and error (2× median) thresholds within a period.
 * With no preceding intervals, there is no timing warning.
 *
 * @param {number} duration
 * @param {number} baseline
 * @returns {{ warning: number, error: number | null } | null}
 */
export function homeStatusDurationStops(duration, baseline) {
  if (!Number.isFinite(duration) || !Number.isFinite(baseline) || baseline <= 0) return null
  const warning = 1.5 * baseline
  const error = 2 * baseline
  if (duration <= warning) return null
  return {
    warning: (warning / duration) * 100,
    error: duration > error ? (error / duration) * 100 : null,
  }
}

function ribbonLabel(periods, counts) {
  const earliest = formatTimestamp(periods[0].entry.date)
  const latest = formatTimestamp(periods[periods.length - 1].entry.date)
  return [
    `Crawler status from ${earliest} to ${latest}.`,
    `${counts.okay} okay, ${counts.warning} warnings, and ${counts.error} errors.`,
  ].join(' ')
}

function formatRibbonDate(value) {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return ''
  return `– ${new Date(timestamp).toISOString().slice(0, 10)} –`
}

function formatTimestamp(value) {
  const timestamp = Date.parse(value || '')
  if (!Number.isFinite(timestamp)) return 'Unknown time'

  const date = new Date(timestamp)
  const datePart = date.toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const timePart = date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${datePart} : ${timePart}`
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
