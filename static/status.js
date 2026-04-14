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
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'

const notesEl = document.getElementById('status-notes')
const artifactsEl = document.getElementById('status-artifacts')
const dateEl = document.querySelector('[data-status-date]')
const badgeEl = document.querySelector('[data-status-badge]')
const badgeLabelEl = document.querySelector('[data-status-label]')
const chartEl = document.querySelector('[data-status-chart]')
const tagDataEl = document.querySelector('[data-status-tag-dates]')
const overflowTagDataEl = document.querySelector('[data-status-tag-overflow]')
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
 *    date: string,
 *    run_id?: string,
 *    notes?: string,
 *    conclusion?: string,
 *    artifacts?: LogArtifact[],
 *    failuresChanged?: boolean,
 *    glitchStartIndex?: number | null
 *  }} LogEntry
 */

/**
 * Release marker rendered at the chart top for tags that fall inside the
 * currently visible day window.
 *
 * @typedef {{
 *    tag: string,
 *    date: string,
 *  }} TagMarker
 */

/**
 * A "just before the window" tag rendered as a left-pointing overflow
 * indicator outside the visible chart range.
 *
 * @typedef {TagMarker} OverflowTagMarker
 */

/** @type {LogEntry[]} */
let logs = []
let index = 0
/** @type {StatusChart | null} */
let chart = null
let emptyStateMessage = ''
/** @type {TagMarker[]} */
const tagMarkers = loadTagMarkers(tagDataEl)
/**
 * Optional tag marker that points to the most recent tag just before the
 * visible window. Rendered as an external left-side indicator.
 *
 * @type {OverflowTagMarker | null}
 */
const overflowTagMarker = loadOverflowTagMarker(overflowTagDataEl)

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
    chart.setOverflowTagMarker(overflowTagMarker)
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
    chart?.setData(logs)
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
  prevButton?.addEventListener('click', () => render(index + 1))
  nextButton?.addEventListener('click', () => render(index - 1))
  lastButton?.addEventListener('click', () => render(0))
}

function bindKeyboard() {
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const target = event.target
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      navigateDay(-1)
    }
    else if (event.key === 'ArrowRight') {
      event.preventDefault()
      navigateDay(1)
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      render(index + 1)
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      render(index - 1)
    }
  })
}

function navigateDay(dayOffset) {
  if (!logs.length) return
  const current = logs[index]
  const currentTs = safeDate(current.date)
  if (!currentTs) return

  const targetTs = shiftTimestampByLocalDays(currentTs, dayOffset)

  const closest = findClosestByTimestamp(targetTs)
  if (closest === -1) return

  const targetEntry = logs[closest]
  const targetEntryTs = safeDate(targetEntry.date)
  if (!targetEntryTs) return

  if (!sameLocalDay(targetEntryTs, targetTs)) return

  render(closest)
}

function findClosestByTimestamp(targetTs) {
  let bestIdx = -1
  let bestDelta = Number.POSITIVE_INFINITY
  logs.forEach((entry, idx) => {
    const ts = safeDate(entry.date)
    if (!ts) return
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

const ASSET_URL = 'https://repackager.sublimetext.io/logs.json'
const FALLBACK_URL = `${window.STATIC_BASE ?? '/static/'}logs.json`
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
  loadLogs().then((entries) => {
    if (!entries.length) return
    const days = chart?.days
    const visibleEntries = typeof days === 'number'
      ? filterEntriesToDayWindow(entries, days)
      : entries
    logs = annotateChanges(visibleEntries)
    chart?.setData(logs)
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

function radiusForEntry(entry, fallbackRadius) {
  const crawledPackages = extractPackagesCrawled(entry.notes || '')
  const MIN_RADIUS = 2
  const MAX_RADIUS = 3
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
    this.tagLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.tagLayer.setAttribute('class', 'tag-lines')
    this.glitchLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.glitchLayer.setAttribute('class', 'glitch-links')
    this.dotLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.svg.appendChild(this.gridLayer)
    this.svg.appendChild(this.labelLayer)
    this.svg.appendChild(this.tagLayer)
    this.svg.appendChild(this.glitchLayer)
    this.svg.appendChild(this.dotLayer)

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
    this.overflowTagMarker = null
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

      if (isMonthStart || isFiveDayTick || i === 0) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
        label.setAttribute('class', isMonthStart ? 'x-label x-label-month' : 'x-label')
        label.setAttribute('x', x)
        label.setAttribute('y', this.height)
        label.textContent = isMonthStart
          ? dayDate.toLocaleString('en-US', { month: 'short' })
          : String(dayDate.getDate())
        this.labelLayer.appendChild(label)

        const callout = document.createElementNS('http://www.w3.org/2000/svg', 'line')
        callout.setAttribute('class', 'x-callout')
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
    this.redrawDots()
  }

  setTagMarkers(markers) {
    this.tagMarkers = markers || []
    this.redrawDots()
  }

  setOverflowTagMarker(marker) {
    this.overflowTagMarker = marker || null
    this.redrawDots()
  }

  redrawDots() {
    this.redrawGridIfDayWindowShifted()

    this.points = []
    while (this.dotLayer.firstChild) this.dotLayer.firstChild.remove()
    while (this.glitchLayer.firstChild) this.glitchLayer.firstChild.remove()
    while (this.tagLayer.firstChild) this.tagLayer.firstChild.remove()

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
      const radius = radiusForEntry(entry, this.radius)
      const node = this.makeDot(entry, x, y, radius, glitchDotIndexes.has(idx))
      positions[idx] = { x, y, radius, dayIndex }

      const cls = classForEntry(entry)
      const isNeutral = cls === '' || cls === 'muted'
      const target = isNeutral ? neutralNodes : otherNodes
      target.push({ entry, node })
    })

    this.drawGlitchLinks(positions)

    // Append neutral first, then everything else on top
    neutralNodes.forEach(({ entry, node }) => {
      this.dotLayer.appendChild(node)
      this.points.push({ entry, node })
    })
    otherNodes.forEach(({ entry, node }) => {
      this.dotLayer.appendChild(node)
      this.points.push({ entry, node })
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

    const runout = cssNumber(this.el, '--status-tag-runout', 9)
    const topY = cssNumber(this.el, '--status-tag-top-y', 10)
    const topYCrisp = crisp(topY)
    const topLineYCrisp = crisp(this.yForHour(0))
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
      const dayElbowX = crisp(dayGroup[0].position.x + runout)
      const oldestTag = dayGroup[0]?.marker?.tag || ''
      const latestTag = dayGroup[dayGroup.length - 1]?.marker?.tag || ''
      const hoverLabel = (dayGroup.length > 1 && oldestTag && latestTag)
        ? `${oldestTag}..${latestTag}`
        : latestTag

      dayGroup.forEach((item, indexInDay) => {
        const { marker, position } = item
        const { x, y } = position
        const dy = Math.max(0, y - topY)
        const projectedTopX = x + runout + dy * leanRatio

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
            lineDefaultPath: defaultPath,
            lineTopPath: topLinePath,
            x: topX,
            dayIndex: position.dayIndex,
            defaultText: marker.tag,
            hoverText: hoverLabel,
            expandsOnHover: hoverLabel !== marker.tag,
          })
        }
      })
    }

    this.setupTagLabelHover(labelEntries)
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
    if (!this.overflowTagMarker) return
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
    label.textContent = this.overflowTagMarker.tag

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = formatTagDateShort(this.overflowTagMarker.date)
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
    circle.setAttribute('cx', x)
    circle.setAttribute('cy', y)
    circle.setAttribute('r', radius)
    circle.dataset.key = (entry.run_id || '') + '|' + (entry.date || '')
    const classes = [
      'dot',
      classForEntry(entry),
      isGlitch ? 'glitch' : '',
      entry.notes ? '' : 'no-notes',
    ]
      .filter(Boolean)
      .join(' ')
    circle.setAttribute('class', classes)
    circle.addEventListener('click', () => {
      if (typeof this.onSelect === 'function') {
        this.onSelect(entry)
      }
    })
    circle.addEventListener('mouseenter', () => {
      if (typeof this.onHover === 'function') {
        this.onHover(entry)
      }
    })
    return circle
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
    const key = (entry?.run_id || '') + '|' + (entry?.date || '')
    let activeNode = null
    this.points.forEach(({ entry: e, node }) => {
      const k = (e.run_id || '') + '|' + (e.date || '')
      if (k === key) {
        node.classList.add('active')
        activeNode = node
      }
      else {
        node.classList.remove('active')
      }
    })
    if (activeNode && activeNode.parentNode === this.dotLayer) {
      // Move active node to the end so it paints on top of siblings
      this.dotLayer.appendChild(activeNode)
    }
  }
}

function classForEntry(entry) {
  const base = classForConclusion(entry.conclusion)
  if (entry.failuresChanged && base !== 'error') {
    return 'changed'
  }
  return base
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

/**
 * Parse the optional overflow marker from inline JSON data.
 *
 * @param {Element | null} el
 * @returns {OverflowTagMarker | null}
 */
function loadOverflowTagMarker(el) {
  if (!el || !el.textContent) return null

  try {
    const raw = JSON.parse(el.textContent)
    if (!raw || typeof raw !== 'object') return null

    const tag = String(raw.tag || '').trim()
    const date = String(raw.date || '').trim()
    if (!tag || !date) return null
    if (!isSemverTag(tag)) return null
    if (!safeDate(date)) return null

    return { tag, date }
  }
  catch (err) {
    console.warn('Failed to parse status overflow tag marker:', err)
    return null
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
