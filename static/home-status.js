import {
  homeStatusDurationStops,
  homeStatusForEntry,
  homeStatusPeriods,
} from './module/home-status.js'

const shellEl = document.querySelector('[data-home-status]')
const ribbonEl = document.querySelector('[data-home-status-ribbon]')
let logsUrl = document.querySelector(
  'meta[name="thecrawl-logs"]',
)?.content
const DATA_MANIFEST_URL = document.querySelector(
  'meta[name="thecrawl-data-manifest"]',
)?.content
const LOG_REFRESH_MS = 10 * 60 * 1000
const RIBBON_TRANSITION_MS = 650
init()

function init() {
  if (!shellEl || !ribbonEl) return

  loadLogs().then(renderRibbon).catch((error) => {
    console.error('Failed to load homepage status:', error)
  })
  startLogRefreshInterval()
}

async function loadLogs(url = logsUrl) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function refreshLogs() {
  try {
    const response = await fetch(DATA_MANIFEST_URL, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const latestLogsUrl = (await response.json())?.logs_url
    if (!latestLogsUrl || latestLogsUrl === logsUrl) return

    const entries = await loadLogs(latestLogsUrl)
    logsUrl = latestLogsUrl
    renderRibbon(entries, true)
  }
  catch (error) {
    console.error('Failed to refresh homepage status:', error)
  }
}

function startLogRefreshInterval() {
  window.setInterval(refreshLogs, LOG_REFRESH_MS)
}

function renderRibbon(entries, animate = false) {
  const periods = homeStatusPeriods(entries)
  if (!periods.length) return

  const shouldAnimate = animate
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const previousRects = shouldAnimate ? ribbonSegmentRects() : new Map()
  const counts = { okay: 0, warning: 0, error: 0 }
  const fragment = document.createDocumentFragment()
  const track = document.createElement('span')
  track.className = 'home-status-track'

  for (const period of periods) {
    const status = homeStatusForEntry(period.entry)
    counts[status] += 1

    const segment = document.createElement('span')
    segment.className = `home-status-segment is-${status}`
    segment.dataset.ribbonKey = ribbonSegmentKey(period)
    segment.style.flexGrow = String(period.duration)
    applyDurationStops(segment, period.duration)
    fragment.appendChild(segment)
  }

  track.appendChild(fragment)
  ribbonEl.replaceChildren(track)
  ribbonEl.setAttribute('aria-label', ribbonLabel(periods, counts))
  ribbonEl.setAttribute('aria-busy', 'false')
  if (shouldAnimate) animateRibbonTrack(track, previousRects)
}

function ribbonSegmentRects() {
  const segments = ribbonEl.querySelectorAll('.home-status-segment')
  return new Map([...segments].map(segment => [
    segment.dataset.ribbonKey,
    segment.getBoundingClientRect(),
  ]))
}

function ribbonSegmentKey(period) {
  return String(period.entry?.run_id || period.timestamp)
}

function animateRibbonTrack(track, previousRects) {
  let offset = 0
  for (const segment of track.children) {
    const previous = previousRects.get(segment.dataset.ribbonKey)
    if (!previous) continue
    offset = previous.right - segment.getBoundingClientRect().right
  }
  if (Math.abs(offset) < 0.1) return

  track.animate([
    { translate: `${offset}px 0` },
    { translate: '0 0' },
  ], {
    duration: RIBBON_TRANSITION_MS,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  })
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
