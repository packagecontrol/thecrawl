import {
  homeStatusDurationStops,
  homeStatusForEntry,
  homeStatusPeriods,
} from './module/home-status.js'

const shellEl = document.querySelector('[data-home-status]')
const ribbonEl = document.querySelector('[data-home-status-ribbon]')
const LOG_URL = document.querySelector(
  'meta[name="thecrawl-logs"]',
)?.content
init()

function init() {
  if (!shellEl || !ribbonEl) return

  loadLogs().then(renderRibbon).catch((error) => {
    console.error('Failed to load homepage status:', error)
  })
}

async function loadLogs() {
  const response = await fetch(LOG_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function renderRibbon(entries) {
  const periods = homeStatusPeriods(entries)
  if (!periods.length) return

  const counts = { okay: 0, warning: 0, error: 0 }
  const fragment = document.createDocumentFragment()

  for (const period of periods) {
    const status = homeStatusForEntry(period.entry)
    counts[status] += 1

    const segment = document.createElement('span')
    segment.className = `home-status-segment is-${status}`
    segment.style.flexGrow = String(period.duration)
    applyDurationStops(segment, period.duration)
    fragment.appendChild(segment)
  }

  ribbonEl.replaceChildren(fragment)
  ribbonEl.setAttribute('aria-label', ribbonLabel(periods, counts))
  ribbonEl.setAttribute('aria-busy', 'false')
}

function applyDurationStops(segment, duration) {
  const stops = homeStatusDurationStops(duration)
  if (!stops) return

  segment.classList.add('has-duration-warning')
  segment.style.setProperty('--duration-warning-stop', `${stops.warning}%`)
  if (stops.error !== null) {
    segment.classList.add('has-duration-error')
    segment.style.setProperty('--duration-error-stop', `${stops.error}%`)
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
