import {
  dayIndexForTimestamp,
  filterEntriesToDayWindow,
  localDayId,
  localDayKey,
  safeDate,
  sameLocalDay,
  shiftTimestampByLocalDays,
} from './module/status-day.js'
import {
  annotateChanges,
  classForConclusion,
  diffFailingPackages,
  extractCurrentlyFailing,
  extractPackagesCrawled,
  isHardFailureWithoutNotes,
  normalizePackageNameKey,
  normalizeStatusNotes,
} from './module/status-failing.js'
import {
  createDirectionalNavigationOrigin,
  createNotesMatcher,
  findDirectionalCorridorTarget,
} from './module/status-search.js'
import {
  parseCrawlHistory,
  resolvePackageRunState,
} from './module/status-history.js'
import { newestTagBeforeDayWindow } from './module/status-tags.js'
import DOMPurify from './vendor/dompurify/purify.es.mjs'
import { marked } from './vendor/marked/marked.esm.js'

const notesEl = document.getElementById('status-notes')
const artifactsEl = document.getElementById('status-artifacts')
const dateEl = document.querySelector('[data-status-date]')
const badgeEl = document.querySelector('[data-status-badge]')
const badgeLabelEl = document.querySelector('[data-status-label]')
const chartEl = document.querySelector('[data-status-chart]')
const chartToolbarEl = document.querySelector('[data-status-chart-toolbar]')
const tagDataEl = document.querySelector('[data-status-tag-dates]')
/** @type {HTMLInputElement | null} */
const notesSearchInput = document.querySelector('[data-status-notes-search]')
/** @type {HTMLButtonElement | null} */
const chartModeButton = document.querySelector('[data-status-mode-toggle]')
/** @type {HTMLButtonElement | null} */
const prevButton = document.querySelector('[data-control="prev"]')
/** @type {HTMLButtonElement | null} */
const nextButton = document.querySelector('[data-control="next"]')
/** @type {HTMLButtonElement | null} */
const lastButton = document.querySelector('[data-control="last"]')

/** @typedef {{
 *    id: number,
 *    name: string,
 *    size: number,
 *    url: string,
 *  }} LogArtifact
 */

/** @typedef {{
 *    name?: string,
 *    detected_at?: string,
 *    published_at?: string,
 *  }} FoundUpdate
 */

/** @typedef {{
 *    date: string,
 *    run_id?: string,
 *    notes?: string,
 *    conclusion?: string,
 *    artifacts?: LogArtifact[],
 *    found_updates?: FoundUpdate[],
 *    failuresChanged?: boolean,
 *    glitchStartIndex?: number | null
 *  }} LogEntry
 */

/**
 * Release marker used by the chart. Markers inside the current day window are
 * rendered at the chart top; the newest marker before the window is rendered as
 * an overflow pointer.
 *
 * @typedef {{
 *    tag: string,
 *    date: string,
 *  }} TagMarker
 */

/** @type {LogEntry[]} */
let logs = []
let index = 0
/** @type {StatusChart | null} */
let chart = null
let notesMatcher = null
let packageSearchRevision = 0
let crawlHistoryPromise = null
let emptyStateMessage = ''
const STATUS_CHART_MODE_STATUS = 'status'
const STATUS_CHART_MODE_UPDATES = 'updates'
const DRAW_DIRECTIONAL_NAVIGATION_CORRIDORS = false
let chartColorMode = STATUS_CHART_MODE_STATUS
/** @type {TagMarker[]} */
const tagMarkers = loadTagMarkers(tagDataEl)

function init() {
  if (!notesEl || !dateEl || !badgeEl) {
    return
  }

  if (chartEl) {
    chart = new StatusChart(chartEl, {
      onSelect: renderEntry,
      onHover: showHoverPreview,
    })
    chart.setTagMarkers(tagMarkers)
    chartEl.addEventListener('mouseleave', restoreActiveEntry)
  }

  bindControls()
  bindKeyboard()
  loadLogs().then((entries) => {
    const days = chart?.days
    const visibleEntries = typeof days === 'number'
      ? filterEntriesToDayWindow(entries, days)
      : entries
    logs = annotateChanges(visibleEntries)
    if (!logs.length) {
      renderEmptyState('No log entries found.')
      return
    }
    if (chart) {
      chart.setData(logs)
      chartToolbarEl?.removeAttribute('hidden')
    }
    const resolved = resolveIndexFromUrl()
    if (resolved.hasRunId && !resolved.found) {
      renderEmptyState(missingRunMessage(resolved.runId))
      return
    }
    render(resolved.index)
  }).catch((err) => {
    console.error('Failed to load logs:', err)
    renderEmptyState('Failed to load logs. Please try again later.')
  })
  startLogRefreshInterval()
}

function bindControls() {
  prevButton?.addEventListener('click', () => renderFromControl(index + 1))
  nextButton?.addEventListener('click', () => renderFromControl(index - 1))
  lastButton?.addEventListener('click', () => renderFromControl(0))

  notesSearchInput?.addEventListener('input', updateNotesSearch)
  notesSearchInput?.addEventListener('keydown', unfocusNotesSearchOnEnter)
  chartModeButton?.addEventListener('mouseenter', previewUpdatesMode)
  chartModeButton?.addEventListener('mouseleave', restoreChartColorMode)
  chartModeButton?.addEventListener('focus', previewUpdatesMode)
  chartModeButton?.addEventListener('blur', restoreChartColorMode)
  chartModeButton?.addEventListener('click', toggleUpdatesMode)
}

function renderFromControl(targetIndex) {
  chart?.resetDirectionalNavigation()
  render(targetIndex)
}

function updateNotesSearch() {
  const query = notesSearchInput?.value || ''
  notesMatcher = createNotesMatcher(query)
  chart?.setPackageRunState(null)
  chart?.setNotesMatcher(notesMatcher)
  updatePackageRunSearch(query)
}

function updatePackageRunSearch(query) {
  const revision = ++packageSearchRevision
  if (!notesMatcher) return

  loadCrawlHistory()
    .then((history) => {
      if (revision !== packageSearchRevision) return
      chart?.setPackageRunState(resolvePackageRunState(history, query))
    })
    .catch((error) => {
      if (revision !== packageSearchRevision) return
      console.warn('Failed to load crawl history:', error)
    })
}

function unfocusNotesSearchOnEnter(event) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  notesSearchInput?.blur()
}

function previewUpdatesMode() {
  if (chartColorMode !== STATUS_CHART_MODE_STATUS) return
  applyChartColorMode(STATUS_CHART_MODE_UPDATES)
}

function restoreChartColorMode() {
  applyChartColorMode(chartColorMode)
}

function toggleUpdatesMode() {
  chartColorMode = chartColorMode === STATUS_CHART_MODE_UPDATES
    ? STATUS_CHART_MODE_STATUS
    : STATUS_CHART_MODE_UPDATES
  applyChartColorMode(chartColorMode)
  updateChartModeButton()
}

function applyChartColorMode(mode) {
  chartEl?.classList.toggle('is-updates-mode', mode === STATUS_CHART_MODE_UPDATES)
}

function updateChartModeButton() {
  const isUpdatesMode = chartColorMode === STATUS_CHART_MODE_UPDATES
  chartModeButton?.setAttribute('aria-pressed', String(isUpdatesMode))
}

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const target = event.target
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }

    if (event.key === 's') {
      event.preventDefault()
      notesSearchInput?.focus()
    }
    else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      navigateHorizontally(-1)
    }
    else if (event.key === 'ArrowRight') {
      event.preventDefault()
      navigateHorizontally(1)
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      navigateVertically(-1)
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      navigateVertically(1)
    }
  })
}

function navigateVertically(direction) {
  const step = direction < 0 ? -1 : 1
  if (notesMatcher && chart) {
    navigateToMatchingPoint({ x: 0, y: step })
    return
  }

  render(index - step)
}

function navigateHorizontally(direction) {
  if (!logs.length || direction === 0) return
  const current = logs[index]
  const step = direction < 0 ? -1 : 1

  if (notesMatcher && chart) {
    navigateToMatchingPoint({ x: step, y: 0 })
    return
  }

  const currentTs = safeDate(current.date)
  if (!currentTs) return
  const targetTs = shiftTimestampByLocalDays(currentTs, step)
  const closest = findClosestByTimestamp(targetTs)
  if (closest >= 0) render(closest)
}

function navigateToMatchingPoint(direction) {
  const current = logs[index]
  const targetEntry = chart?.findNearestMatchingEntry(current, direction)
  if (!targetEntry) return

  const targetIndex = findEntryIndex(targetEntry)
  if (targetIndex >= 0) render(targetIndex)
}

function findClosestByTimestamp(targetTs) {
  let bestIdx = -1
  let bestDelta = Number.POSITIVE_INFINITY
  logs.forEach((entry, idx) => {
    const ts = safeDate(entry.date)
    if (!ts || !sameLocalDay(ts, targetTs)) return
    const delta = Math.abs(ts - targetTs)
    if (delta < bestDelta) {
      bestDelta = delta
      bestIdx = idx
    }
  })
  return bestIdx
}

function resolveIndexFromUrl() {
  if (!logs.length || typeof window === 'undefined') {
    return { index: 0, hasRunId: false, found: false, runId: null }
  }
  const url = new URL(window.location.href)
  const runId = url.searchParams.get('run_id')
  if (!runId) {
    return { index: 0, hasRunId: false, found: false, runId: null }
  }
  const found = logs.findIndex(entry => entry.run_id && String(entry.run_id) === runId)
  if (found >= 0) {
    return { index: found, hasRunId: true, found: true, runId }
  }
  return { index: 0, hasRunId: true, found: false, runId }
}

const ASSET_URL = new URL('../logs.json', import.meta.url)
const HISTORY_ASSET_URL = new URL('../crawl-history.json', import.meta.url)
const FALLBACK_URL = 'https://repackager.sublimetext.io/logs.json'
const LOG_REFRESH_MS = 10 * 60 * 1000
const MAX_SKIPPED_HARD_FAILURES = 4

async function loadLogs() {
  const sources = [
    () => fetch(ASSET_URL),
    () => fetch(FALLBACK_URL),
  ]

  let lastError = null
  for (const fn of sources) {
    try {
      const res = await fn()
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      /** @type {LogEntry[]} */
      const data = await res.json()
      return [...data].sort((a, b) => safeDate(b.date) - safeDate(a.date))
    }
    catch (err) {
      lastError = err
    }
  }

  throw lastError || new Error('Failed to load logs')
}

function loadCrawlHistory() {
  crawlHistoryPromise ||= fetch(HISTORY_ASSET_URL).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseCrawlHistory(await response.json())
  })
  return crawlHistoryPromise
}

/**
 * @param {number} targetIndex
 */
function render(targetIndex) {
  if (!logs.length) return

  index = clamp(targetIndex, 0, logs.length - 1)
  const entry = logs[index]
  if (!entry) return
  emptyStateMessage = ''

  updateHeading(entry)
  renderNotes(entry, index)
  updateButtons()
  chart?.highlight(entry)
  updateUrl(entry)
}

function refreshLogs() {
  const wasAtNewest = logs.length > 0 && index === 0 && !emptyStateMessage

  loadLogs().then((entries) => {
    if (!entries.length) return
    const days = chart?.days
    const visibleEntries = typeof days === 'number'
      ? filterEntriesToDayWindow(entries, days)
      : entries
    logs = annotateChanges(visibleEntries)
    chart?.setData(logs)
    if (wasAtNewest) {
      render(0)
      return
    }
    const resolved = resolveIndexFromUrl()
    if (resolved.hasRunId && !resolved.found) {
      renderEmptyState(missingRunMessage(resolved.runId))
      return
    }
    render(resolved.index)
  }).catch((err) => {
    console.error('Failed to refresh logs:', err)
  })
}

function startLogRefreshInterval() {
  window.setInterval(refreshLogs, LOG_REFRESH_MS)
}

/**
 * @param {LogEntry} entry
 */
function updateHeading(entry) {
  const formatted = formatDate(entry.date)
  dateEl.textContent = formatted

  const conclusion = entry.conclusion || 'unknown'
  const badgeInfo = badgeFor(conclusion)

  badgeLabelEl.textContent = badgeInfo.label === 'unknown' ? '' : badgeInfo.label
  badgeEl.className = `status-badge ${badgeInfo.className}`
}

/**
 * @param {LogEntry} entry
 * @param {number} entryIndex
 */
function renderNotes(entry, entryIndex) {
  if (!entry.notes) {
    notesEl.innerHTML = `
      <p>No notes for this run. (${linkToRun(entry.run_id)})</p>
    `
    renderArtifacts(entry)
    return
  }

  const normalized = normalizeStatusNotes(entry.notes)
  const html = marked.parse(normalized, { breaks: true })
  notesEl.innerHTML = DOMPurify.isSupported
    ? DOMPurify.sanitize(html)
    : html
  applyFailureChangeMarkers(entry, entryIndex)
  renderArtifacts(entry)
}

/**
 * @param {LogEntry} entry
 * @param {number} entryIndex
 */
function applyFailureChangeMarkers(entry, entryIndex) {
  if (!entry.failuresChanged) return
  if (!Number.isInteger(entryIndex) || entryIndex < 0) return

  const previousEntry = findComparablePreviousEntryForMarkers(entryIndex)
  if (!previousEntry) return

  const diff = diffFailingPackages(entry.notes || '', previousEntry.notes || '')
  const heading = findCurrentlyFailingHeading(notesEl)
  if (!heading) return

  const sectionNodes = collectSectionNodesAfterHeading(heading)
  const packageList = findCurrentlyFailingPackageList(sectionNodes)
  const highlighted = highlightPackageNamesInList(packageList, diff.changedNames)
  const insertedRemoved = insertRemovedFailingItemsInList(packageList, diff.removedBlocks)

  if (highlighted === 0 && insertedRemoved === 0) {
    highlightHeadingText(heading)
  }
}

function findComparablePreviousEntryForMarkers(entryIndex) {
  let skippedHardFailures = 0

  for (let i = entryIndex + 1; i < logs.length; i += 1) {
    const candidate = logs[i]
    const section = extractCurrentlyFailing(candidate.notes || '')
    if (section === false && isHardFailureWithoutNotes(candidate)) {
      skippedHardFailures += 1
      if (skippedHardFailures > MAX_SKIPPED_HARD_FAILURES) {
        return null
      }
      continue
    }
    if (section === false) {
      return null
    }
    return candidate
  }

  return null
}

/**
 * @param {LogEntry} entry
 */
function renderArtifacts(entry) {
  if (!artifactsEl) return

  const artifacts = artifactsForEntry(entry)
  if (!artifacts.length) {
    artifactsEl.replaceChildren()
    artifactsEl.hidden = true
    return
  }

  artifactsEl.hidden = false

  const table = document.createElement('table')
  table.className = 'status-artifact-table'

  const tbody = document.createElement('tbody')
  for (const artifact of artifacts) {
    const row = document.createElement('tr')

    const nameCell = document.createElement('td')
    nameCell.textContent = artifact.name
    row.appendChild(nameCell)

    const sizeCell = document.createElement('td')
    sizeCell.textContent = formatArtifactSize(artifact.size)
    row.appendChild(sizeCell)

    const linkCell = document.createElement('td')
    const link = document.createElement('a')
    link.href = artifact.url
    link.textContent = 'Download'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    linkCell.appendChild(link)
    row.appendChild(linkCell)

    tbody.appendChild(row)
  }

  table.appendChild(tbody)
  artifactsEl.replaceChildren(table)
}

/**
 * @param {LogEntry} entry
 */
function artifactsForEntry(entry) {
  return normalizeArtifacts(entry.artifacts)
}

/**
 * @param {LogArtifact[] | undefined} artifacts
 */
function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) return []
  return artifacts
}

/**
 * @param {number} size
 */
function formatArtifactSize(size) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value < 10 && unitIndex > 0 ? 1 : 0
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

function updateButtons() {
  const atNewest = index === 0
  const atOldest = index === logs.length - 1

  lastButton && (lastButton.disabled = atNewest)
  nextButton && (nextButton.disabled = atNewest)
  prevButton && (prevButton.disabled = atOldest)
}

function renderEmptyState(message) {
  dateEl.textContent = ''
  badgeLabelEl.textContent = '¯\\_(ツ)_/¯'
  badgeEl.className = 'status-badge status-badge-muted'
  notesEl.innerHTML = `<p>${message}</p>`
  if (artifactsEl) {
    artifactsEl.replaceChildren()
    artifactsEl.hidden = true
  }
  emptyStateMessage = message

  ;[prevButton, nextButton, lastButton].forEach((btn) => {
    if (btn) btn.disabled = true
  })
}

/**
 * @param {string | undefined} value
 */
function formatDate(value) {
  const ts = safeDate(value)
  if (!ts) return 'Unknown time'
  try {
    const date = new Date(ts)
    const datePart = date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZoneName: undefined,
    })
    const timePart = date.toLocaleString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    return `${datePart} : ${timePart}`
  }
  catch {
    return new Date(ts).toISOString()
  }
}

/**
 * @param {string} conclusion
 */
function badgeFor(conclusion) {
  const normalized = conclusion.toLowerCase()
  const label = normalized.replace(/_/g, ' ')

  if (normalized === 'success') {
    return { label, className: 'status-badge-success' }
  }

  if (['failure', 'failed', 'cancelled', 'timed_out'].includes(normalized)) {
    return { label, className: 'status-badge-error' }
  }

  if (['action_required', 'neutral', 'stale'].includes(normalized)) {
    return { label, className: 'status-badge-warning' }
  }

  return { label, className: 'status-badge-muted' }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function roundedElbowPath(startX, startY, elbowX, endY, endX, radius) {
  const vdir = endY >= startY ? 1 : -1
  const hdist = Math.abs(elbowX - startX)
  const vdist = Math.abs(endY - startY)
  const r = Math.min(radius, hdist, vdist / 2)
  if (r <= 0) {
    return `M ${startX} ${startY} L ${elbowX} ${startY} L ${elbowX} ${endY} L ${endX} ${endY}`
  }
  // Q = https://svg-tutorial.com/editor/quadratic-bezier
  return [
    `M ${startX} ${startY}`,
    `L ${elbowX + r} ${startY}`,
    `Q ${elbowX} ${startY} ${elbowX} ${startY + vdir * r}`,
    `L ${elbowX} ${endY - vdir * r}`,
    `Q ${elbowX} ${endY} ${elbowX + r} ${endY}`,
    `L ${endX} ${endY}`,
  ].join(' ')
}

function roundedCornerToLimit(startX, startY, elbowX, limitY, radius) {
  const vdir = limitY >= startY ? 1 : -1
  const hdist = Math.abs(elbowX - startX)
  const vdist = Math.abs(limitY - startY)
  const r = Math.min(radius, hdist, vdist)
  if (r <= 0) {
    return `M ${startX} ${startY} L ${elbowX} ${startY} L ${elbowX} ${limitY}`
  }
  return [
    `M ${startX} ${startY}`,
    `L ${elbowX + r} ${startY}`,
    `Q ${elbowX} ${startY} ${elbowX} ${startY + vdir * r}`,
    `L ${elbowX} ${limitY}`,
  ].join(' ')
}

function radiusForEntry(entry, fallbackRadius, notesMatcher = null) {
  const MIN_RADIUS = 2
  const MAX_RADIUS = 3

  if (notesMatcher) {
    return notesMatcher(entry.notes || '') ? MAX_RADIUS : MIN_RADIUS
  }

  const crawledPackages = extractPackagesCrawled(entry.notes || '')
  const MIN_PACKAGES = 100
  const MAX_PACKAGES = 400
  if (crawledPackages === null) return fallbackRadius
  return clamp(
    // Map MIN_PACKAGES-MAX_PACKAGES to 0-1 for radius scaling.
    MIN_RADIUS + ((crawledPackages - MIN_PACKAGES) / (MAX_PACKAGES - MIN_PACKAGES)) * (MAX_RADIUS - MIN_RADIUS),
    MIN_RADIUS,
    MAX_RADIUS,
  )
}

/**
 * @param {LogEntry} entry
 */
function showHoverPreview(entry) {
  if (!entry) return
  const previewIndex = findEntryIndex(entry)
  updateHeading(entry)
  renderNotes(entry, previewIndex)
}

function restoreActiveEntry() {
  if (emptyStateMessage) {
    renderEmptyState(emptyStateMessage)
    return
  }
  render(index)
}

/**
 * @param {LogEntry} entry
 */
function renderEntry(entry) {
  if (!entry || !logs.length) return
  chart?.resetDirectionalNavigation()
  const idx = findEntryIndex(entry)
  if (idx >= 0) {
    render(idx)
  }
}

function findEntryIndex(entry) {
  return logs.findIndex((it) => {
    if (it.run_id && entry.run_id && it.run_id === entry.run_id) return true
    return it.date === entry.date
  })
}

class StatusChart {
  constructor(el, { onSelect, onHover } = {}) {
    this.el = el
    this.onSelect = onSelect
    this.onHover = onHover
    this.svg = el.querySelector('svg')
    this.gridLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.gridLayer.setAttribute('class', 'grid')
    this.labelLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.labelLayer.setAttribute('class', 'labels')
    this.directionalNavigationLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.directionalNavigationLayer.setAttribute('class', 'directional-navigation')
    this.tagLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.tagLayer.setAttribute('class', 'tag-lines')
    this.glitchLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.glitchLayer.setAttribute('class', 'glitch-links')
    this.updateLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.updateLayer.setAttribute('class', 'update-lines')
    this.updateConnectorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.updateConnectorLayer.setAttribute('class', 'update-connectors')
    this.updateMarkerLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.updateMarkerLayer.setAttribute('class', 'update-markers')
    this.updateLayer.appendChild(this.updateConnectorLayer)
    this.updateLayer.appendChild(this.updateMarkerLayer)
    this.dotLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.inlineTagLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.inlineTagLayer.setAttribute('class', 'inline-tag-labels')
    this.svg.appendChild(this.gridLayer)
    this.svg.appendChild(this.labelLayer)
    this.svg.appendChild(this.directionalNavigationLayer)
    this.svg.appendChild(this.tagLayer)
    this.svg.appendChild(this.glitchLayer)
    this.svg.appendChild(this.updateLayer)
    this.svg.appendChild(this.dotLayer)
    this.svg.appendChild(this.inlineTagLayer)

    // Fixed chart constants
    this.padding = { top: 16, right: 32, bottom: 16, left: 32 }
    this.radius = 3
    this.days = 30
    // Defaults overridden in layout()
    this.barWidth = 12
    this.hourHeight = 12
    this.height = 320
    this.width = this.el.clientWidth || 400
    this.svg.setAttribute('preserveAspectRatio', 'none')

    this.points = []
    this.entries = []
    this.tagMarkers = []
    this.notesMatcher = null
    this.packageRunState = null
    this.directionalNavigation = null
    this.selectedUpdateEntryKey = ''
    this.hoveredUpdateEntryKey = ''
    this.gridAnchorDayKey = currentLocalDayKey()

    this.resizeObserver = new ResizeObserver(() => this.layout())
    this.resizeObserver.observe(this.el)
    this.layout()
  }

  layout() {
    this.width = this.el.clientWidth || this.width
    this.height = this.el.clientHeight || this.height
    const usableHeight = Math.max(1, this.height - this.padding.top - this.padding.bottom)
    const usableWidth = Math.max(1, this.width - this.padding.left - this.padding.right)
    this.hourHeight = usableHeight / 24
    this.barWidth = usableWidth / this.days
    this.svg.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`)
    this.drawGrid()
    this.redrawDots()
  }

  drawGrid() {
    while (this.gridLayer.firstChild) this.gridLayer.firstChild.remove()
    while (this.labelLayer.firstChild) this.labelLayer.firstChild.remove()
    const xPositions = []
    // vertical grid: one per day (at center)
    for (let i = 0; i < this.days; i++) {
      const x = crisp(this.padding.left + (this.days - 1 - i + 0.5) * this.barWidth)
      xPositions.push(x)
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', x)
      line.setAttribute('x2', x)
      line.setAttribute('y1', crisp(this.padding.top))
      line.setAttribute('y2', crisp(this.height - this.padding.bottom))
      this.gridLayer.appendChild(line)

      // Compute the actual calendar date for this day slot
      const dayDate = new Date()
      dayDate.setHours(0, 0, 0, 0)
      dayDate.setDate(dayDate.getDate() - i)

      const isMonthStart = dayDate.getDate() === 1
      const isFiveDayTick = dayDate.getDate() % 5 === 0
      // This only marks month-end labels that exist (normally day 30), since
      // the other possible month-end dates are not five-day ticks.
      const nextDayDate = new Date(dayDate)
      nextDayDate.setDate(nextDayDate.getDate() + 1)
      const isNextVisibleDayFirstOfMonth = i > 0 && nextDayDate.getDate() === 1

      if (isMonthStart || isFiveDayTick || i === 0) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        const labelClasses = [
          'x-label',
          isMonthStart ? 'x-label-month' : '',
          isNextVisibleDayFirstOfMonth ? 'x-label-before-month' : '',
        ].filter(Boolean)
        label.setAttribute('class', labelClasses.join(' '))
        label.setAttribute('x', x)
        label.setAttribute('y', this.height)
        label.textContent = isMonthStart
          ? dayDate.toLocaleString('en-US', { month: 'short' })
          : String(dayDate.getDate())
        this.labelLayer.appendChild(label)

        const callout = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        callout.setAttribute(
          'class',
          isNextVisibleDayFirstOfMonth ? 'x-callout x-callout-before-month' : 'x-callout',
        )
        callout.setAttribute('x1', x)
        callout.setAttribute('x2', x)
        // + 1 to not overwrite the x-axis
        callout.setAttribute('y1', crisp(this.height - this.padding.bottom + 1))
        callout.setAttribute('y2', crisp(this.height - 10))
        this.labelLayer.appendChild(callout)
      }
    }
    const gridStartX = Math.min(...xPositions)
    const gridEndX = Math.max(...xPositions)
    // horizontal lines every hour (lighter), stronger every 6 hours
    for (let h = 0; h <= 24; h += 1) {
      const y = crisp(this.yForHour(h))
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      // Let the top line snap to the vertical grid bounds
      const lineStart = h === 0 ? gridStartX : crisp(this.padding.left)
      const lineEnd = h === 0 ? gridEndX : crisp(this.width - this.padding.right - 4)
      line.setAttribute('x1', lineStart)
      line.setAttribute('x2', lineEnd)
      line.setAttribute('y1', y)
      line.setAttribute('y2', y)
      if (h % 6 !== 0) {
        line.setAttribute('stroke-opacity', '0.25')
      }
      if (h === 24) {
        line.dataset.axis = 'true'
      }
      this.gridLayer.appendChild(line)

      if (h % 6 === 0) {
        const labelLeft = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        labelLeft.setAttribute('class', 'y-label')
        labelLeft.setAttribute('x', this.padding.left - 6)
        labelLeft.setAttribute('y', y)
        labelLeft.setAttribute('text-anchor', 'end')
        labelLeft.textContent = formatHourLabel(h)
        this.labelLayer.appendChild(labelLeft)

        const labelRight = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        labelRight.setAttribute('class', 'y-label')
        labelRight.setAttribute('x', this.width - this.padding.right + 6)
        labelRight.setAttribute('y', y)
        labelRight.setAttribute('text-anchor', 'start')
        labelRight.textContent = formatHourLabel(h)
        this.labelLayer.appendChild(labelRight)
      }
    }

    // x-axis arrow on the right
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    const axisY = crisp(this.yForHour(24))
    const baseX = crisp(this.width - this.padding.right - 4)
    const size = 6
    const points = [
      `${baseX + size},${axisY}`,
      `${baseX},${axisY - size / 2}`,
      `${baseX},${axisY + size / 2}`,
    ].join(' ')
    arrow.setAttribute('points', points)
    arrow.setAttribute('class', 'x-arrow')
    this.labelLayer.appendChild(arrow)

    this.gridAnchorDayKey = currentLocalDayKey()
  }

  setData(entries) {
    this.entries = entries || []
    this.resetDirectionalNavigation()
    this.redrawDots()
  }

  setNotesMatcher(matcher) {
    this.notesMatcher = matcher
    this.resetDirectionalNavigation()
    this.points.forEach(({ entry, node }) => {
      node.setAttribute('r', radiusForEntry(entry, this.radius, this.notesMatcher))
      this.updateDotNotesSearchState(entry, node)
      this.updateDotPackageRunState(entry, node)
    })
  }

  setPackageRunState(state) {
    this.packageRunState = state
    this.points.forEach(({ entry, node }) => {
      this.updateDotPackageRunState(entry, node)
    })
  }

  findNearestMatchingEntry(entry, direction) {
    if (!this.notesMatcher || !entry) return null

    const current = this.pointForEntry(entry)
    const navigation = createDirectionalNavigationOrigin(
      current,
      direction,
      this.directionalNavigation,
    )
    if (!current || !navigation) return null

    const { axis, corridor, movement, point: navigationOrigin } = navigation
    const corridorRadius = axis === 'horizontal'
      ? this.hourHeight * 3
      : this.barWidth

    let target = this.reverseDirectionalPoint(current, movement)
    let warped = false
    if (!target) {
      const matchingPoints = this.points.filter(point => (
        this.notesMatcher(point.entry.notes || '')
      ))
      const result = findDirectionalCorridorTarget(
        matchingPoints,
        navigationOrigin,
        movement,
        corridorRadius,
      )
      target = result?.point || null
      warped = result?.warped || false
    }
    if (!target) {
      this.directionalNavigationLayer.replaceChildren()
      return null
    }

    if (DRAW_DIRECTIONAL_NAVIGATION_CORRIDORS) {
      this.drawDirectionalNavigationCorridor(
        navigationOrigin,
        target,
        movement,
        corridorRadius,
        warped,
      )
    }
    this.directionalNavigation = {
      axis,
      corridor,
      fromKey: entryKey(current.entry),
      toKey: entryKey(target.entry),
      x: movement.x,
      y: movement.y,
      warped,
    }
    return target.entry
  }

  resetDirectionalNavigation() {
    this.directionalNavigation = null
    this.directionalNavigationLayer.replaceChildren()
  }

  drawDirectionalNavigationCorridor(origin, target, direction, radius, warped) {
    const columnHalfWidth = direction.y !== 0 ? this.barWidth / 2 : 0
    const visualRadius = radius + columnHalfWidth
    const outer = this.directionalCorridorRect(origin, direction, visualRadius)
    if (!outer) return

    const outerNode = this.makeDirectionalCorridor(
      outer,
      'directional-navigation-corridor',
      true,
    )
    outerNode.dataset.fromKey = entryKey(origin.entry)
    outerNode.dataset.toKey = entryKey(target.entry)
    outerNode.dataset.corridorRadius = String(radius)
    outerNode.dataset.warped = String(warped)
    this.directionalNavigationLayer.replaceChildren(outerNode)
  }

  directionalCorridorRect(origin, direction, radius) {
    if (!(radius > 0)) return null

    const left = this.padding.left
    const right = this.width - this.padding.right
    const top = this.padding.top
    const bottom = this.height - this.padding.bottom

    if (direction.x !== 0) {
      const y = Math.max(top, origin.y - radius)
      const corridorBottom = Math.min(bottom, origin.y + radius)
      return {
        axis: 'horizontal',
        x: left,
        y,
        width: right - left,
        height: corridorBottom - y,
      }
    }

    const x = Math.max(left, origin.x - radius)
    const corridorRight = Math.min(right, origin.x + radius)
    return {
      axis: 'vertical',
      x,
      y: top,
      width: corridorRight - x,
      height: bottom - top,
    }
  }

  makeDirectionalCorridor(geometry, className, drawEdges) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', className)

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('class', 'directional-navigation-corridor-fill')
    rect.setAttribute('x', String(geometry.x))
    rect.setAttribute('y', String(geometry.y))
    rect.setAttribute('width', String(Math.max(0, geometry.width)))
    rect.setAttribute('height', String(Math.max(0, geometry.height)))
    group.appendChild(rect)

    if (!drawEdges) return group

    if (geometry.axis === 'horizontal') {
      group.appendChild(this.makeDirectionalCorridorEdge(
        geometry.x,
        geometry.y,
        geometry.x + geometry.width,
        geometry.y,
      ))
      group.appendChild(this.makeDirectionalCorridorEdge(
        geometry.x,
        geometry.y + geometry.height,
        geometry.x + geometry.width,
        geometry.y + geometry.height,
      ))
    }
    else {
      group.appendChild(this.makeDirectionalCorridorEdge(
        geometry.x,
        geometry.y,
        geometry.x,
        geometry.y + geometry.height,
      ))
      group.appendChild(this.makeDirectionalCorridorEdge(
        geometry.x + geometry.width,
        geometry.y,
        geometry.x + geometry.width,
        geometry.y + geometry.height,
      ))
    }

    return group
  }

  makeDirectionalCorridorEdge(x1, y1, x2, y2) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('class', 'directional-navigation-corridor-edge')
    line.setAttribute('x1', String(x1))
    line.setAttribute('y1', String(y1))
    line.setAttribute('x2', String(x2))
    line.setAttribute('y2', String(y2))
    return line
  }

  pointForEntry(entry) {
    const key = entryKey(entry)
    return this.points.find(point => entryKey(point.entry) === key) || null
  }

  reverseDirectionalPoint(current, direction) {
    const previous = this.directionalNavigation
    if (!previous) return null
    if (previous.toKey !== entryKey(current.entry)) return null
    if (previous.x !== -direction.x || previous.y !== -direction.y) return null

    return this.points.find(point => (
      entryKey(point.entry) === previous.fromKey
      && this.notesMatcher(point.entry.notes || '')
    )) || null
  }

  setTagMarkers(markers) {
    this.tagMarkers = markers || []
    this.redrawDots()
  }

  redrawDots() {
    this.redrawGridIfDayWindowShifted()

    this.points = []
    this.directionalNavigation = null
    this.directionalNavigationLayer.replaceChildren()
    while (this.dotLayer.firstChild) this.dotLayer.firstChild.remove()
    while (this.glitchLayer.firstChild) this.glitchLayer.firstChild.remove()
    while (this.updateConnectorLayer.firstChild) this.updateConnectorLayer.firstChild.remove()
    while (this.updateMarkerLayer.firstChild) this.updateMarkerLayer.firstChild.remove()
    while (this.tagLayer.firstChild) this.tagLayer.firstChild.remove()
    while (this.inlineTagLayer.firstChild) this.inlineTagLayer.firstChild.remove()

    this.drawTagMarkers()
    this.drawOverflowTagMarker()
    if (!this.entries.length) return

    const todayDayId = localDayId(Date.now())

    const neutralNodes = []
    const otherNodes = []
    const positions = new Array(this.entries.length).fill(null)
    const glitchDotIndexes = new Set()

    this.entries.forEach((entry, idx) => {
      const startIndex = entry.glitchStartIndex
      if (typeof startIndex !== 'number' || startIndex <= idx) return
      glitchDotIndexes.add(startIndex)
      glitchDotIndexes.add(idx)
    })

    this.entries.forEach((entry, idx) => {
      const ts = safeDate(entry.date)
      if (!ts) return
      const position = this.positionForTimestamp(ts, { todayDayId })
      if (!position) return

      const { x, y, dayIndex } = position
      const radius = radiusForEntry(entry, this.radius, this.notesMatcher)
      const node = this.makeDot(entry, x, y, radius, glitchDotIndexes.has(idx))
      positions[idx] = { x, y, radius, dayIndex }

      const cls = classForEntry(entry)
      const isNeutral = cls === '' || cls === 'muted'
      const target = isNeutral ? neutralNodes : otherNodes
      target.push({ entry, node, x, y })
    })

    this.drawGlitchLinks(positions)
    this.drawUpdateLines(positions)

    // Append neutral first, then everything else on top
    neutralNodes.forEach((point) => {
      this.dotLayer.appendChild(point.node)
      this.points.push(point)
    })
    otherNodes.forEach((point) => {
      this.dotLayer.appendChild(point.node)
      this.points.push(point)
    })
  }

  redrawGridIfDayWindowShifted() {
    const todayKey = currentLocalDayKey()
    if (todayKey === this.gridAnchorDayKey) {
      return
    }

    this.drawGrid()
  }

  drawTagMarkers() {
    if (!this.tagMarkers.length) return

    const baseRunout = cssNumber(this.el, '--status-tag-runout', 9)
    const minRunout = cssNumber(this.el, '--status-tag-min-runout', 3)
    const topY = cssNumber(this.el, '--status-tag-top-y', 10)
    const topLineY = this.yForHour(0)
    const topYCrisp = crisp(topY)
    const topLineYCrisp = crisp(topLineY)
    const leanDeg = cssNumber(this.el, '--status-tag-lean-deg', 0.6)
    const labelOffsetX = cssNumber(this.el, '--status-tag-label-offset-x', 0)
    const labelOffsetY = cssNumber(this.el, '--status-tag-label-offset-y', 2)
    const leanRatio = Math.tan((leanDeg * Math.PI) / 180)

    const todayDayId = localDayId(Date.now())

    const visibleMarkers = this.tagMarkers
      .map((marker) => {
        const ts = safeDate(marker.date)
        if (!ts) return null
        const position = this.positionForTimestamp(ts, { todayDayId })
        if (!position) return null
        return { marker, ts, position }
      })
      .filter(Boolean)
      .sort((a, b) => a.ts - b.ts)

    if (!visibleMarkers.length) return

    const groupsByDay = new Map()
    visibleMarkers.forEach((item) => {
      const dayKey = localDayKey(item.ts)
      const existing = groupsByDay.get(dayKey)
      if (existing) {
        existing.push(item)
      }
      else {
        groupsByDay.set(dayKey, [item])
      }
    })

    const labelEntries = []

    for (const dayGroup of groupsByDay.values()) {
      let oldestTopX = null
      const dayLineNodes = []
      const dayRunout = this.tagRunoutForDayGroup(dayGroup, baseRunout, minRunout, leanRatio, topY, topLineY)
      const dayElbowX = crisp(dayGroup[0].position.x + dayRunout)
      const oldestTag = dayGroup[0]?.marker?.tag || ''
      const latestTag = dayGroup[dayGroup.length - 1]?.marker?.tag || ''
      const hoverLabel = (dayGroup.length > 1 && oldestTag && latestTag)
        ? `${oldestTag}..${latestTag}`
        : latestTag

      dayGroup.forEach((item, indexInDay) => {
        const { marker, position } = item
        const { x, y } = position
        const dy = Math.max(0, y - topY)
        const projectedTopX = x + dayRunout + dy * leanRatio

        if (oldestTopX === null) {
          oldestTopX = crisp(projectedTopX)
        }

        const topX = oldestTopX + indexInDay

        const startYCrisp = crisp(y)
        const defaultPath = [
          `M ${crisp(x)} ${startYCrisp}`,
          `L ${dayElbowX} ${startYCrisp}`,
          `L ${topX} ${topYCrisp}`,
        ].join(' ')
        const topLinePath = [
          `M ${crisp(x)} ${startYCrisp}`,
          `L ${dayElbowX} ${startYCrisp}`,
          `L ${topX} ${topLineYCrisp}`,
        ].join(' ')

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        line.setAttribute('class', 'tag-line')
        line.setAttribute('d', defaultPath)
        line.dataset.tag = marker.tag
        this.tagLayer.appendChild(line)
        dayLineNodes.push(line)

        const isLatestInDay = indexInDay === dayGroup.length - 1
        if (isLatestInDay) {
          const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
          label.setAttribute('class', 'tag-label')
          label.setAttribute('x', String(crisp(topX + labelOffsetX)))
          label.setAttribute('y', String(crisp(topY - labelOffsetY)))
          label.textContent = marker.tag
          this.tagLayer.appendChild(label)

          labelEntries.push({
            node: label,
            lineNode: line,
            lineNodes: dayLineNodes,
            lineDefaultPath: defaultPath,
            lineTopPath: topLinePath,
            x: topX,
            y,
            dayIndex: position.dayIndex,
            position,
            markerItems: dayGroup,
            defaultText: marker.tag,
            hoverText: hoverLabel,
            expandsOnHover: hoverLabel !== marker.tag,
          })
        }
      })
    }

    const omittedEntries = this.omitOverlappingTopTagCallouts(labelEntries)
    this.drawInlineTagLabels(omittedEntries)
    this.setupTagLabelHover(labelEntries.filter(entry => !entry.isTopCalloutOmitted))
  }

  /**
   * Compute the horizontal elbow/runout for version tag callout lines.
   *
   * A simple version uses a fixed runout, which looks good at normal viewport
   * widths. On narrower viewports, the actual version line moves farther into
   * the next column. We therefore say that the crossing between the 00:00 grid
   * line and the version line should not cross the midpoint between two days.
   * This way, the line always leans toward the day it belongs to.
   *
   * Keep the preferred fixed value while there is room, then shrink it just
   * enough to keep that top-line crossing inside this tag's day column.
   *
   * For a single tag, the crossing point at the 00:00 line is approximately:
   *
   *   xCross = dotX + runout + (dotY - topLineY) * leanRatio
   *
   * We want xCross <= dotX + barWidth / 2, so:
   *
   *   runout <= barWidth / 2 - (dotY - topLineY) * leanRatio
   *
   * Same-day tag groups nudge later top endpoints by 1px each to keep the
   * individual lines distinguishable, so the algorithm computes the largest
   * top-line drift in the group and solves against that worst case. The result
   * is clamped between the normal configured runout and a small minimum so the
   * elbow remains visible even when the chart is very narrow.
   */
  tagRunoutForDayGroup(dayGroup, baseRunout, minRunout, leanRatio, topY, topLineY) {
    const halfDayWidth = this.barWidth / 2
    const maxTopLineDrift = this.maxTagTopLineDrift(dayGroup, leanRatio, topY, topLineY)
    const maxRunout = halfDayWidth - maxTopLineDrift
    const upperRunout = Math.max(minRunout, maxRunout)
    return clamp(baseRunout, minRunout, upperRunout)
  }

  maxTagTopLineDrift(dayGroup, leanRatio, topY, topLineY) {
    let maxDrift = 0

    for (let i = 0; i < dayGroup.length; i += 1) {
      const y = dayGroup[i]?.position?.y
      if (!Number.isFinite(y)) continue

      // For a single tag line:
      //   xCross = dotX + runout + (dotY - topLineY) * leanRatio
      // This is the part after runout. Multiple tags on the same day are
      // spread by one extra pixel at the top, so include that proportional
      // drift too.
      const leanDrift = Math.max(0, y - topLineY) * leanRatio
      const extraTopDrift = this.tagTopSpreadDrift(i, y, topY, topLineY)
      maxDrift = Math.max(maxDrift, leanDrift + extraTopDrift)
    }

    return maxDrift
  }

  tagTopSpreadDrift(indexInDay, dotY, topY, topLineY) {
    if (indexInDay <= 0 || dotY <= topLineY) return 0

    const verticalSpan = dotY - topY
    if (verticalSpan <= 0) return 0

    return indexInDay * ((dotY - topLineY) / verticalSpan)
  }

  omitOverlappingTopTagCallouts(entries) {
    if (!entries.length) return []

    const gap = cssNumber(this.el, '--status-tag-label-min-gap-x', 2)
    const ordered = [...entries].sort((a, b) => b.x - a.x)
    const kept = []
    const omitted = []

    for (const entry of ordered) {
      entry.labelWidth = this.tagLabelWidth(entry.node, entry.defaultText)
      const shouldOmit = kept.some(keptEntry => this.topTagCalloutOverlapsKeptEntry(entry, keptEntry, gap))

      if (shouldOmit) {
        entry.isTopCalloutOmitted = true
        omitted.push(entry)
        this.removeTopTagCallout(entry)
      }
      else {
        kept.push(entry)
      }
    }

    return omitted
  }

  topTagCalloutOverlapsKeptEntry(entry, keptEntry, gap) {
    // Use stable day-column distance for adjacent days. The rendered top-label
    // x positions can shift as tag runout shrinks, which otherwise makes the
    // omit/inline decision flicker across nearby viewport widths.
    const dayDistance = Math.abs(entry.dayIndex - keptEntry.dayIndex)
    const availableWidth = dayDistance > 0
      ? dayDistance * this.barWidth
      : Math.abs(entry.x - keptEntry.x)
    const requiredWidth = ((entry.labelWidth || 0) + (keptEntry.labelWidth || 0)) / 2 + gap
    return availableWidth <= requiredWidth
  }

  removeTopTagCallout(entry) {
    entry.node.remove()
    const lineNodes = entry.lineNodes || [entry.lineNode]
    for (const lineNode of lineNodes) {
      lineNode?.remove()
    }
  }

  drawInlineTagLabels(entries) {
    if (!entries.length) return

    const clusters = this.inlineTagClusters(entries)
    for (const cluster of clusters) {
      this.drawInlineTagLabel(this.inlineTagLabelData(cluster))
    }
  }

  /**
   * Multiple inline version callouts within a short period can visually
   * overlap. Combine versions that occur within n visual hours into one
   * callout, draw it at the newest version's position, and reveal the full
   * version range on hover.
   */
  inlineTagClusters(entries) {
    const clusterHours = cssNumber(this.el, '--status-tag-inline-cluster-hours', 1)
    const maxGapY = this.hourHeight * clusterHours
    const sorted = [...entries].sort((a, b) => a.y - b.y)
    const clusters = []

    for (const entry of sorted) {
      const current = clusters[clusters.length - 1]
      if (!current || entry.y - current.lastY > maxGapY) {
        clusters.push({ entries: [entry], lastY: entry.y })
      }
      else {
        current.entries.push(entry)
        current.lastY = entry.y
      }
    }

    return clusters.map(cluster => cluster.entries)
  }

  inlineTagLabelData(entries) {
    const markerItems = entries
      .flatMap(entry => entry.markerItems || [])
      .sort((a, b) => a.ts - b.ts)
    const oldest = markerItems[0]
    const latest = markerItems[markerItems.length - 1]
    const defaultText = latest?.marker?.tag || entries[entries.length - 1]?.defaultText || ''
    const hoverText = markerItems.length > 1 && oldest?.marker?.tag
      ? `${oldest.marker.tag}..${defaultText}`
      : defaultText

    return {
      x: latest?.position?.x ?? entries[entries.length - 1]?.position?.x ?? 0,
      y: latest?.position?.y ?? entries[entries.length - 1]?.position?.y ?? 0,
      defaultText,
      hoverText,
      expandsOnHover: hoverText !== defaultText,
    }
  }

  drawInlineTagLabel(data) {
    if (!data.defaultText) return

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'tag-inline-callout')

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    line.setAttribute('class', 'tag-inline-line')
    group.appendChild(line)

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('class', 'tag-inline-label-bg')
    group.appendChild(bg)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('class', 'tag-inline-label')
    label.textContent = data.defaultText
    group.appendChild(label)

    const entry = { ...data, group, line, bg, node: label }
    this.inlineTagLayer.appendChild(group)
    this.layoutInlineTagLabel(entry)

    if (entry.expandsOnHover) {
      group.addEventListener('mouseenter', () => {
        label.textContent = entry.hoverText
        this.layoutInlineTagBackground(entry)
      })
      group.addEventListener('mouseleave', () => {
        label.textContent = entry.defaultText
        this.layoutInlineTagBackground(entry)
      })
    }
  }

  layoutInlineTagLabel(entry) {
    const geometry = this.inlineTagGeometry(entry)

    Object.assign(entry, geometry)
    entry.node.setAttribute('x', String(crisp(geometry.textX)))
    entry.node.setAttribute('y', String(crisp(geometry.textY)))
    entry.node.setAttribute('text-anchor', 'start')
    this.layoutInlineTagBackground(entry)
    this.layoutInlineTagLine(entry)
  }

  layoutInlineTagBackground(entry) {
    const paddingX = cssNumber(this.el, '--status-tag-inline-padding-x', 2)
    const paddingY = cssNumber(this.el, '--status-tag-inline-padding-y', 1)
    const radius = cssNumber(this.el, '--status-tag-inline-radius', 3)
    const box = this.tagLabelBox(entry.node)

    entry.bg.setAttribute('x', String(box.x - paddingX))
    entry.bg.setAttribute('y', String(box.y - paddingY))
    entry.bg.setAttribute('width', String(box.width + paddingX * 2))
    entry.bg.setAttribute('height', String(box.height + paddingY * 2))
    entry.bg.setAttribute('rx', String(radius))
    entry.bg.setAttribute('ry', String(radius))
  }

  layoutInlineTagLine(entry) {
    const path = [
      `M ${crisp(entry.lineStartX)} ${crisp(entry.y)}`,
      `L ${crisp(entry.lineElbowX)} ${crisp(entry.y)}`,
      `L ${crisp(entry.lineElbowX)} ${crisp(entry.lineEndY)}`,
    ].join(' ')

    entry.line.setAttribute('d', path)
  }

  inlineTagGeometry(entry) {
    const runout = cssNumber(this.el, '--status-tag-inline-runout', 6)
    const rise = cssNumber(this.el, '--status-tag-inline-rise', 6)
    const textOffsetX = cssNumber(this.el, '--status-tag-inline-text-offset-x', -3)
    const textOffsetY = cssNumber(this.el, '--status-tag-inline-text-offset-y', -3)
    const downTextShiftX = cssNumber(this.el, '--status-tag-inline-down-text-shift-x', 1)
    const downTextShiftY = cssNumber(this.el, '--status-tag-inline-down-text-shift-y', -3)
    const nearTopHours = cssNumber(this.el, '--status-tag-inline-near-top-hours', 1)
    const fallbackFontSize = cssNumber(this.el, '--status-tag-inline-font-size', 9)
    const topLineY = this.yForHour(0)
    const drawsDown = entry.y - topLineY <= this.hourHeight * nearTopHours
    const ydir = drawsDown ? 1 : -1
    const lineStartX = entry.x + this.radius
    const lineElbowX = lineStartX + runout
    const lineEndY = entry.y + ydir * rise
    const textX = lineElbowX + textOffsetX + (drawsDown ? downTextShiftX : 0)
    const textY = drawsDown
      ? lineEndY + fallbackFontSize + Math.abs(textOffsetY) + downTextShiftY
      : lineEndY + textOffsetY

    return {
      lineStartX,
      lineElbowX,
      lineEndY,
      textX,
      textY,
    }
  }

  tagLabelBox(node) {
    try {
      if (typeof node.getBBox === 'function') {
        const box = node.getBBox()
        if (box && Number.isFinite(box.width) && Number.isFinite(box.height)) {
          return box
        }
      }
    }
    catch {
      // Fall back below when SVG layout metrics are unavailable.
    }

    const fallbackFontSize = cssNumber(this.el, '--status-tag-inline-font-size', 9)
    return {
      x: Number.parseFloat(node.getAttribute('x') || '0'),
      y: Number.parseFloat(node.getAttribute('y') || '0') - fallbackFontSize,
      width: this.tagLabelWidth(node, node.textContent),
      height: fallbackFontSize,
    }
  }

  tagLabelWidth(node, text) {
    try {
      if (typeof node.getComputedTextLength === 'function') {
        const width = node.getComputedTextLength()
        if (Number.isFinite(width) && width > 0) return width
      }
    }
    catch {
      // Fall back to the measured monospace-ish digit width below.
    }

    const charWidth = cssNumber(this.el, '--status-tag-label-fallback-char-width', 6)
    return String(text || '').length * charWidth
  }

  setupTagLabelHover(entries) {
    if (!entries.length) return

    const ordered = [...entries].sort((a, b) => a.x - b.x)
    const dayRadius = Math.max(0, Math.floor(cssNumber(this.el, '--status-tag-hover-hide-day-radius', 1)))

    ordered.forEach((entry) => {
      if (!entry.expandsOnHover) return

      entry.node.addEventListener('mouseenter', () => {
        this.activateTagLabelHover(entry, ordered, dayRadius)
      })
      entry.node.addEventListener('mouseleave', () => {
        this.resetTagLabelHover(ordered)
      })
    })
  }

  activateTagLabelHover(activeEntry, entries, dayRadius) {
    this.resetTagLabelHover(entries)
    activeEntry.node.textContent = activeEntry.hoverText

    const neighborsToHide = this.tagLabelNeighborsWithinDayRadius(activeEntry, entries, dayRadius)
    neighborsToHide.forEach((entry) => {
      entry.node.classList.add('tag-label-neighbor-hidden')
      if (entry.lineNode && entry.lineTopPath) {
        entry.lineNode.setAttribute('d', entry.lineTopPath)
      }
    })
  }

  tagLabelNeighborsWithinDayRadius(activeEntry, entries, dayRadius) {
    if (!activeEntry || !Number.isFinite(activeEntry.dayIndex)) return []
    if (!Number.isFinite(dayRadius) || dayRadius <= 0) return []

    return entries.filter((entry) => {
      if (entry === activeEntry) return false
      if (!Number.isFinite(entry.dayIndex)) return false
      const dayDistance = Math.abs(entry.dayIndex - activeEntry.dayIndex)
      return dayDistance > 0 && dayDistance <= dayRadius
    })
  }

  resetTagLabelHover(entries) {
    entries.forEach((entry) => {
      entry.node.textContent = entry.defaultText
      entry.node.classList.remove('tag-label-neighbor-hidden')
      if (entry.lineNode && entry.lineDefaultPath) {
        entry.lineNode.setAttribute('d', entry.lineDefaultPath)
      }
    })
  }

  /**
   * Draw a left-edge overflow pointer for the last tag before the visible
   * window. This makes it clear the visible tag history continues to older
   * versions off-screen.
   *
   * We hide this marker when the oldest visible days already have top tag
   * labels/lines, because the left edge would become visually crowded.
   */
  drawOverflowTagMarker() {
    const overflowTagMarker = newestTagBeforeDayWindow(this.tagMarkers, this.days)
    if (!overflowTagMarker) return
    if (this.hasTagMarkersInOldestDays()) {
      return
    }

    const topY = cssNumber(this.el, '--status-tag-top-y', 10)
    const labelOffsetY = cssNumber(this.el, '--status-tag-label-offset-y', 3)
    const labelY = topY - labelOffsetY
    const centerOffset = cssNumber(this.el, '--status-tag-overflow-center-offset', 3)
    const overflowY = labelY - centerOffset
    const shaftLength = cssNumber(this.el, '--status-tag-overflow-shaft', 30)
    const shiftX = cssNumber(this.el, '--status-tag-overflow-shift-x', -3)
    const arrowHeadLength = cssNumber(this.el, '--status-tag-overflow-arrow-length', 4)
    const arrowHalfWidth = cssNumber(this.el, '--status-tag-overflow-arrow-half-width', 3)
    const labelGap = cssNumber(this.el, '--status-tag-overflow-label-gap', 6)

    const tipX = this.xForDayIndex(this.days - 1)
    const shaftStartX = tipX + arrowHeadLength
    const shaftEndX = shaftStartX + shaftLength

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.setAttribute('class', 'tag-overflow')
    group.setAttribute('transform', `translate(${shiftX} 0)`)

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('class', 'tag-overflow-line')
    line.setAttribute('x1', String(crisp(shaftStartX)))
    line.setAttribute('x2', String(crisp(shaftEndX)))
    line.setAttribute('y1', String(crisp(overflowY)))
    line.setAttribute('y2', String(crisp(overflowY)))
    group.appendChild(line)

    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    arrow.setAttribute('class', 'tag-overflow-arrow')
    arrow.setAttribute('points', [
      `${crisp(tipX)},${crisp(overflowY)}`,
      `${crisp(shaftStartX)},${crisp(overflowY - arrowHalfWidth)}`,
      `${crisp(shaftStartX)},${crisp(overflowY + arrowHalfWidth)}`,
    ].join(' '))
    group.appendChild(arrow)

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('class', 'tag-overflow-label')
    label.setAttribute('x', String(crisp(shaftEndX + labelGap)))
    label.setAttribute('y', String(crisp(labelY)))
    label.textContent = overflowTagMarker.tag

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = formatTagDateShort(overflowTagMarker.date)
    label.appendChild(title)

    group.appendChild(label)
    this.tagLayer.appendChild(group)
  }

  /**
   * True when regular tag markers already occupy the oldest visible day slots.
   * Used as a coarse "no room left" signal for the overflow pointer.
   */
  hasTagMarkersInOldestDays() {
    if (!this.tagMarkers.length) return false

    const todayDayId = localDayId(Date.now())
    const OLDEST_DAYS = 12
    const oldestStart = Math.max(0, this.days - OLDEST_DAYS)

    return this.tagMarkers.some((marker) => {
      const ts = safeDate(marker.date)
      if (!ts) return false
      const pos = this.positionForTimestamp(ts, { todayDayId })
      return Boolean(pos && pos.dayIndex >= oldestStart)
    })
  }

  makeDot(entry, x, y, radius, isGlitch = false) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', crisp(x))
    circle.setAttribute('cy', y)
    circle.setAttribute('r', radius)
    circle.dataset.key = entryKey(entry)
    const classes = [
      'dot',
      classForEntry(entry),
      isGlitch ? 'glitch' : '',
      hasFoundUpdates(entry) ? 'has-updates' : '',
      entry.notes ? '' : 'no-notes',
    ]
      .filter(Boolean)
      .join(' ')
    circle.setAttribute('class', classes)
    this.updateDotNotesSearchState(entry, circle)
    this.updateDotPackageRunState(entry, circle)
    circle.addEventListener('click', () => {
      if (typeof this.onSelect === 'function') {
        this.onSelect(entry)
      }
    })
    circle.addEventListener('mouseenter', () => {
      if (hasFoundUpdates(entry)) {
        this.showUpdateConnectors(entry)
      }
      else {
        this.hideUpdateConnectors()
      }
      if (typeof this.onHover === 'function') {
        this.onHover(entry)
      }
    })
    circle.addEventListener('mouseleave', () => {
      this.hideUpdateConnectors()
    })
    return circle
  }

  updateDotNotesSearchState(entry, node) {
    const matches = this.notesMatcher
      ? this.notesMatcher(entry.notes || '')
      : null
    node.classList.toggle('notes-search-match', matches === true)
    node.classList.toggle('notes-search-nonmatch', matches === false)
  }

  updateDotPackageRunState(entry, node) {
    const runId = String(entry.run_id || '')
    const state = this.notesMatcher ? this.packageRunState : null
    const isAvailable = Boolean(state?.availableRunIds.has(runId))
    const wasTouched = Boolean(isAvailable && state.touchedRunIds.has(runId))

    node.classList.toggle('package-run-touched', wasTouched)
    node.classList.toggle('package-run-untouched', isAvailable && !wasTouched)
    node.classList.toggle('package-run-unknown', Boolean(state && !isAvailable))
  }

  drawUpdateLines(positions) {
    const todayDayId = localDayId(Date.now())
    const MARKER_HALF_WIDTH = 3
    let connectorIndex = 0

    this.entries.forEach((entry, idx) => {
      const runPos = positions[idx]
      if (!runPos) return

      const key = entryKey(entry)
      const updates = updatesForEntry(entry)
      for (const update of updates) {
        const publishedTs = safeDate(update.published_at)
        if (!publishedTs) continue

        const publishedPos = this.positionForTimestamp(publishedTs, { todayDayId })
        if (!publishedPos) continue

        const connector = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        connector.setAttribute('class', 'update-connector')
        connector.setAttribute('d', this.updateConnectorPath(runPos, publishedPos, connectorIndex))
        connector.dataset.entryKey = key
        connectorIndex += 1

        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        marker.setAttribute('class', 'update-line')
        marker.setAttribute('x1', String(crisp(publishedPos.x - MARKER_HALF_WIDTH)))
        marker.setAttribute('y1', String(crisp(publishedPos.y)))
        marker.setAttribute('x2', String(crisp(publishedPos.x + MARKER_HALF_WIDTH)))
        marker.setAttribute('y2', String(crisp(publishedPos.y)))

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
        title.textContent = updateLineTitle(update)
        marker.appendChild(title)

        this.updateConnectorLayer.appendChild(connector)
        this.updateMarkerLayer.appendChild(marker)
      }
    })
  }

  showUpdateConnectors(entry) {
    this.hoveredUpdateEntryKey = entryKey(entry)
    this.syncUpdateConnectorHighlights()
  }

  hideUpdateConnectors() {
    this.hoveredUpdateEntryKey = ''
    this.syncUpdateConnectorHighlights()
  }

  syncUpdateConnectorHighlights() {
    for (const node of this.updateConnectorLayer.children) {
      const key = node.dataset.entryKey
      node.classList.toggle('is-active', key === this.hoveredUpdateEntryKey || key === this.selectedUpdateEntryKey)
    }
  }

  updateConnectorPath(runPos, publishedPos, connectorIndex) {
    const verticalDirection = publishedPos.y < runPos.y ? -1 : 1
    const horizontalDirection = connectorIndex % 2 === 0 ? -1 : 1
    const verticalGap = Math.abs(publishedPos.y - runPos.y)
    const horizontalGap = Math.abs(publishedPos.x - runPos.x)
    const lateralOffset = clamp(horizontalGap * 0.18 + verticalGap * 0.35, 4, 26)
    const verticalOffset = clamp(verticalGap * 0.12, 3, 12)
    const controlX = runPos.x + horizontalDirection * lateralOffset
    const controlY = runPos.y + verticalDirection * verticalOffset

    return [
      `M ${crisp(runPos.x)} ${crisp(runPos.y)}`,
      `Q ${crisp(controlX)} ${crisp(controlY)} ${crisp(publishedPos.x)} ${crisp(publishedPos.y)}`,
    ].join(' ')
  }

  drawGlitchLinks(positions) {
    const OFFSET = 4
    const CORNER_RADIUS = 2
    this.entries.forEach((entry, idx) => {
      const startIndex = entry.glitchStartIndex
      if (typeof startIndex !== 'number' || startIndex <= idx) return
      const startPos = positions[startIndex]
      const endPos = positions[idx]
      if (!startPos || !endPos) return

      const startX = startPos.x - startPos.radius
      const startY = startPos.y
      const endX = endPos.x - endPos.radius
      const endY = endPos.y
      const startLeftX = startX - OFFSET
      const endLeftX = endX - OFFSET
      const topY = crisp(this.padding.top)
      const bottomY = crisp(this.height - this.padding.bottom)

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('class', 'glitch-link')
      if (startPos.dayIndex !== endPos.dayIndex) {
        const older = { x: startX, y: startY, leftX: startLeftX, limitY: bottomY }
        const newer = { x: endX, y: endY, leftX: endLeftX, limitY: topY }
        const olderPath = roundedCornerToLimit(older.x, older.y, older.leftX, older.limitY, CORNER_RADIUS)
        const newerPath = roundedCornerToLimit(newer.x, newer.y, newer.leftX, newer.limitY, CORNER_RADIUS)
        path.setAttribute('d', `${olderPath} ${newerPath}`)
      }
      else {
        const leftX = Math.min(startLeftX, endLeftX)
        path.setAttribute('d', roundedElbowPath(startX, startY, leftX, endY, endX, CORNER_RADIUS))
      }
      this.glitchLayer.appendChild(path)
    })
  }

  positionForTimestamp(ts, { todayDayId } = {}) {
    const anchorDayId = Number.isFinite(todayDayId) ? todayDayId : localDayId(Date.now())
    const diffDays = dayIndexForTimestamp(ts, anchorDayId)
    if (!Number.isFinite(diffDays) || diffDays < 0 || diffDays >= this.days) return null

    const d = new Date(ts)
    const hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
    const x = this.xForDayIndex(diffDays)
    const y = this.yForHour(hour)
    return { x, y, dayIndex: diffDays }
  }

  xForDayIndex(dayIndex) {
    return this.padding.left + (this.days - 1 - dayIndex + 0.5) * this.barWidth
  }

  yForHour(hour) {
    return this.padding.top + hour * this.hourHeight
  }

  highlight(entry) {
    const key = entryKey(entry)
    let activeNode = null
    this.points.forEach(({ entry: e, node }) => {
      const k = entryKey(e)
      if (k === key) {
        node.classList.add('active')
        activeNode = node
      }
      else {
        node.classList.remove('active')
      }
    })
    this.selectedUpdateEntryKey = hasFoundUpdates(entry) ? key : ''
    this.syncUpdateConnectorHighlights()

    if (activeNode && activeNode.parentNode === this.dotLayer) {
      // Move active node to the end so it paints on top of siblings
      this.dotLayer.appendChild(activeNode)
    }
  }
}

function entryKey(entry) {
  return (entry?.run_id || '') + '|' + (entry?.date || '')
}

function classForEntry(entry) {
  const base = classForConclusion(entry.conclusion)
  if (entry.failuresChanged && base !== 'error') {
    return 'changed'
  }
  return base
}

function hasFoundUpdates(entry) {
  return updatesForEntry(entry).length > 0
}

function updatesForEntry(entry) {
  return Array.isArray(entry?.found_updates) ? entry.found_updates : []
}

function updateLineTitle(update) {
  const name = String(update.name || 'Package update')
  const publishedAt = formatTagDateShort(update.published_at)
  return `${name} published at ${publishedAt}`
}

function formatHourLabel(hour) {
  const h = String(hour).padStart(2, '0')
  return `${h}:00`
}

function currentLocalDayKey() {
  return localDayKey(Date.now())
}

function linkToRun(runId, label = 'logs') {
  if (!runId) return ''
  const href = `https://github.com/packagecontrol/thecrawl/actions/runs/${runId}`
  return `<a href="${href}">${label}</a>`
}

function missingRunMessage(runId) {
  const link = linkToRun(runId, 'GitHub')
  return `No data for this run_id. Maybe it is still on ${link}.`
}

/**
 * Parse in-window release tag markers from inline JSON data.
 *
 * @param {Element | null} el
 * @returns {TagMarker[]}
 */
function loadTagMarkers(el) {
  if (!el || !el.textContent) return []

  try {
    const raw = JSON.parse(el.textContent)
    if (!Array.isArray(raw)) return []

    return raw
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const tag = String(item.tag || '').trim()
        const date = String(item.date || '').trim()
        if (!tag || !date) return null
        if (!isSemverTag(tag)) return null
        if (!safeDate(date)) return null
        return { tag, date }
      })
      .filter(Boolean)
  }
  catch (err) {
    console.warn('Failed to parse status tag markers:', err)
    return []
  }
}

function isSemverTag(tag) {
  return /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)
}

function formatTagDateShort(value) {
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(String(value || '').trim())
  if (direct) return direct[1]

  const ts = safeDate(value)
  if (!ts) return String(value || '').trim()
  return new Date(ts).toISOString().slice(0, 10)
}

/**
 * Update the URL query to reflect the current entry.
 * Uses replaceState to avoid adding history entries.
 * @param {LogEntry} entry
 */
function updateUrl(entry) {
  const url = new URL(window.location.href)
  if (entry.run_id) {
    url.searchParams.set('run_id', entry.run_id)
  }
  else {
    url.searchParams.delete('run_id')
  }
  window.history.replaceState({}, '', url.toString())
}

function findCurrentlyFailingHeading(root) {
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (const heading of headings) {
    if ((heading.textContent || '').trim().toLowerCase() === 'currently failing') {
      return heading
    }
  }
  return null
}

function collectSectionNodesAfterHeading(heading) {
  const nodes = []
  let node = heading.nextElementSibling

  while (node) {
    if (/^H[1-6]$/.test(node.tagName)) {
      break
    }
    nodes.push(node)
    node = node.nextElementSibling
  }

  return nodes
}

function highlightPackageNamesInList(list, changedNames) {
  if (!list || !changedNames.size) return 0

  let highlighted = 0
  const names = list.querySelectorAll(':scope > li strong')
  for (const nameNode of names) {
    const key = normalizePackageNameKey(nameNode.textContent)
    if (!changedNames.has(key)) continue
    const row = nameNode.closest('li')
    if (!row) continue
    row.classList.add('status-change-marker')
    highlighted += 1
  }

  return highlighted
}

function insertRemovedFailingItemsInList(list, removedBlocks) {
  if (!list || !removedBlocks.length) return 0

  let inserted = 0
  for (const block of removedBlocks) {
    const item = makeRemovedFailingListItem(block.name)
    const anchorItem = findListItemByPackageKey(list, block.anchorNameKey)
    if (anchorItem) {
      list.insertBefore(item, anchorItem)
    }
    else {
      list.appendChild(item)
    }
    inserted += 1
  }

  return inserted
}

function findCurrentlyFailingPackageList(sectionNodes) {
  const candidates = []

  for (const node of sectionNodes) {
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      candidates.push(node)
    }
    const nested = node.querySelectorAll('ul, ol')
    for (const list of nested) {
      candidates.push(list)
    }
  }

  for (const candidate of candidates) {
    if (candidate.querySelector('li strong')) {
      return candidate
    }
  }

  return null
}

function findListItemByPackageKey(list, packageNameKey) {
  if (!packageNameKey) return null

  const names = list.querySelectorAll(':scope > li strong')
  for (const nameNode of names) {
    const key = normalizePackageNameKey(nameNode.textContent)
    if (key !== packageNameKey) continue
    return nameNode.closest('li')
  }

  return null
}

function makeRemovedFailingListItem(name) {
  const item = document.createElement('li')
  item.className = 'status-removed-failing-item'

  const label = document.createElement('strong')
  label.className = 'status-removed-failing-name'
  label.textContent = name
  item.appendChild(label)

  return item
}

function highlightHeadingText(heading) {
  const existing = heading.querySelector('.status-change-marker')
  if (existing) return

  const marker = document.createElement('span')
  marker.className = 'status-change-marker'
  marker.textContent = heading.textContent || ''
  heading.replaceChildren(marker)
}

function cssNumber(el, variableName, fallback) {
  if (!el) return fallback
  const value = getComputedStyle(el).getPropertyValue(variableName)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function crisp(value) {
  return Math.round(value) + 0.5
}

init()
