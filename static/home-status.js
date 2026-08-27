import {
  homeStatusForEntry,
  homeStatusPeriods,
} from './module/home-status.js'

const shellEl = document.querySelector('[data-home-status]')
const ribbonEl = document.querySelector('[data-home-status-ribbon]')
const LOG_URLS = [
  '/logs.json',
  'https://repackager.sublimetext.io/logs.json',
]
const STATUS_LABELS = {
  okay: 'Okay',
  warning: 'Unexpected package failure',
  error: 'Run failed',
}

init()

function init() {
  if (!shellEl || !ribbonEl) return

  loadLogs().then(renderRibbon).catch((error) => {
    console.error('Failed to load homepage status:', error)
  })
}

async function loadLogs() {
  let lastError = null
  for (const url of LOG_URLS) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    }
    catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Failed to load logs')
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
    segment.title = segmentTitle(period.entry, status, period.duration)
    fragment.appendChild(segment)
  }

  ribbonEl.replaceChildren(fragment)
  ribbonEl.setAttribute('aria-label', ribbonLabel(periods, counts))
  ribbonEl.setAttribute('aria-busy', 'false')
}

function segmentTitle(entry, status, duration) {
  const started = formatTimestamp(entry.date)
  const label = STATUS_LABELS[status]
  return `${started} — ${label} — ${formatDuration(duration)}`
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
  return new Date(timestamp).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatDuration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} hr`
  const days = hours / 24
  return `${days.toFixed(days < 10 ? 1 : 0)} days`
}
