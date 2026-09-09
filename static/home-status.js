import { homeStatusView } from './module/home-status.js'

const shellEl = document.querySelector('[data-home-status]')
const ribbonEl = document.querySelector('[data-home-status-ribbon]')
const tooltipDateEl = document.querySelector('[data-home-status-tooltip-date]')
let logsUrl = document.querySelector(
  'meta[name="thecrawl-logs"]',
)?.content
const DATA_MANIFEST_URL = document.querySelector(
  'meta[name="thecrawl-data-manifest"]',
)?.content
const DATA_REFRESH_MS = 10 * 60 * 1000
const RIBBON_TRANSITION_MS = 650
init()

function init() {
  if (!shellEl || !ribbonEl) return

  if (!ribbonEl.querySelector('.home-status-track')) {
    loadLogs().then(renderRibbon).catch((error) => {
      console.error('Failed to load homepage status:', error)
    })
  }
  ribbonEl.addEventListener('pointerover', showRibbonDate)
  ribbonEl.addEventListener('pointerleave', hideRibbonDate)
  startDataRefreshInterval()
}

async function loadLogs(url = logsUrl) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function refreshData() {
  try {
    const response = await fetch(DATA_MANIFEST_URL, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const manifest = await response.json()
    refreshArtifactCounts(manifest?.artifact_counts)

    const latestLogsUrl = manifest?.logs_url
    if (!latestLogsUrl || latestLogsUrl === logsUrl) return

    const entries = await loadLogs(latestLogsUrl)
    logsUrl = latestLogsUrl
    renderRibbon(entries, true)
  }
  catch (error) {
    console.error('Failed to refresh homepage data:', error)
  }
}

function startDataRefreshInterval() {
  window.setInterval(refreshData, DATA_REFRESH_MS)
}

async function refreshArtifactCounts(counts) {
  if (!counts || typeof window.animateArtifactCounts !== 'function') return

  try {
    await window.animateArtifactCounts(counts)
  }
  catch (error) {
    console.error('Failed to refresh homepage artifact counts:', error)
  }
}

function renderRibbon(entries, animate = false) {
  const view = homeStatusView(entries)
  if (!view.segments.length) return

  const shouldAnimate = animate
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const previousRects = shouldAnimate ? ribbonSegmentRects() : new Map()
  const fragment = document.createDocumentFragment()
  const track = document.createElement('span')
  track.className = 'home-status-track'

  for (const item of view.segments) {
    const segment = document.createElement('span')
    segment.className = item.className
    segment.dataset.ribbonKey = item.key
    segment.dataset.ribbonDate = item.date
    segment.setAttribute('style', item.style)
    fragment.appendChild(segment)
  }

  track.appendChild(fragment)
  hideRibbonDate()
  ribbonEl.replaceChildren(track)
  ribbonEl.setAttribute('aria-label', view.label)
  ribbonEl.setAttribute('aria-busy', 'false')
  if (shouldAnimate) animateRibbonTrack(track, previousRects)
}

function showRibbonDate(event) {
  const segment = event.target.closest?.('.home-status-segment')
  const date = segment?.dataset.ribbonDate
  if (!date || !tooltipDateEl) return

  tooltipDateEl.textContent = date
  shellEl.classList.add('is-date-hovered')
}

function hideRibbonDate() {
  shellEl.classList.remove('is-date-hovered')
}

function ribbonSegmentRects() {
  const segments = ribbonEl.querySelectorAll('.home-status-segment')
  return new Map([...segments].map(segment => [
    segment.dataset.ribbonKey,
    segment.getBoundingClientRect(),
  ]))
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
