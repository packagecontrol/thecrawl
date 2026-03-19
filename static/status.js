import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'

const notesEl = document.getElementById('status-notes')
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
 *    date: string,
 *    run_id?: string,
 *    notes?: string,
 *    conclusion?: string,
 *    failuresChanged?: boolean,
 *    glitchStartIndex?: number | null
 *  }} LogEntry
 */

/** @typedef {{
 *    tag: string,
 *    date: string,
 *  }} TagMarker
 */

/** @typedef {{
 *    tag: string,
 *    date: string,
 *  }} OverflowTagMarker
 */

/** @type {LogEntry[]} */
let logs = []
let index = 0
/** @type {StatusChart | null} */
let chart = null
let emptyStateMessage = ''
/** @type {TagMarker[]} */
const tagMarkers = loadTagMarkers()
/** @type {OverflowTagMarker | null} */
const overflowTagMarker = loadOverflowTagMarker()

function filterEntriesToWindow(entries, days) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const msInDay = 24 * 60 * 60 * 1000
  return entries.filter((entry) => {
    const ts = safeDate(entry.date)
    if (!ts) return false
    const d = new Date(ts)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const diffDays = Math.floor((todayStart - dayStart) / msInDay)
    return diffDays >= 0 && diffDays < days
  })
}

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
    const visibleEntries = typeof days === 'number' ? filterEntriesToWindow(entries, days) : entries
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

  const DAY_MS = 24 * 60 * 60 * 1000
  const targetTs = currentTs + dayOffset * DAY_MS
  const desiredDay = new Date(targetTs).getDate()

  const closest = findClosestByTimestamp(targetTs)
  if (closest === -1) return

  const targetEntry = logs[closest]
  const targetEntryTs = safeDate(targetEntry.date)
  if (!targetEntryTs) return

  const targetDay = new Date(targetEntryTs).getDate()
  if (targetDay !== desiredDay) return

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
  renderNotes(entry)
  updateButtons()
  chart?.highlight(entry)
  updateUrl(entry)
}

function refreshLogs() {
  loadLogs().then((entries) => {
    if (!entries.length) return
    const days = chart?.days
    const visibleEntries = typeof days === 'number' ? filterEntriesToWindow(entries, days) : entries
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
 */
function renderNotes(entry) {
  if (!entry.notes) {
    notesEl.innerHTML = `
      <p>No notes for this run. (${linkToRun(entry.run_id)})</p>
    `
    return
  }

  const normalized = normalizeNotes(entry.notes)
  const html = marked.parse(normalized, { breaks: true })
  notesEl.innerHTML = DOMPurify.isSupported
    ? DOMPurify.sanitize(html)
    : html
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
 * @param {string | undefined} value
 */
function safeDate(value) {
  const t = value ? Date.parse(value) : NaN
  return Number.isFinite(t) ? t : 0
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

/**
 * Normalize newlines and ensure blank lines so markdown renders paragraphs.
 * @param {string} text
 */
function normalizeNotes(text) {
  return text
    .replace(/\r\n?/g, '\n')
    // Added 2026-01-11; delete after 2026-02-12
    .replace(/\*\*currently failing\*\*:\s*\n/gi, '#### Currently failing\n')
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
  updateHeading(entry)
  renderNotes(entry)
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
  const idx = logs.findIndex((it) => {
    if (it.run_id && entry.run_id && it.run_id === entry.run_id) return true
    return it.date === entry.date
  })
  if (idx >= 0) {
    render(idx)
  }
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
    this.points = []
    while (this.dotLayer.firstChild) this.dotLayer.firstChild.remove()
    while (this.glitchLayer.firstChild) this.glitchLayer.firstChild.remove()
    while (this.tagLayer.firstChild) this.tagLayer.firstChild.remove()

    this.drawTagMarkers()
    this.drawOverflowTagMarker()
    if (!this.entries.length) return

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msInDay = 24 * 60 * 60 * 1000

    const neutralNodes = []
    const otherNodes = []
    const positions = new Array(this.entries.length).fill(null)

    this.entries.forEach((entry, idx) => {
      const ts = Date.parse(entry.date || 0)
      if (!Number.isFinite(ts)) return
      const position = this.positionForTimestamp(ts, { todayStart, msInDay })
      if (!position) return

      const { x, y, dayIndex } = position
      const radius = radiusForEntry(entry, this.radius)
      const node = this.makeDot(entry, x, y, radius)
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

  drawTagMarkers() {
    if (!this.tagMarkers.length) return

    const runout = cssNumber(this.el, '--status-tag-runout', 9)
    const topY = cssNumber(this.el, '--status-tag-top-y', 10)
    const topYCrisp = crisp(topY)
    const leanDeg = cssNumber(this.el, '--status-tag-lean-deg', 0.6)
    const labelOffsetX = cssNumber(this.el, '--status-tag-label-offset-x', 0)
    const labelOffsetY = cssNumber(this.el, '--status-tag-label-offset-y', 2)
    const leanRatio = Math.tan((leanDeg * Math.PI) / 180)

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msInDay = 24 * 60 * 60 * 1000

    const visibleMarkers = this.tagMarkers
      .map((marker) => {
        const ts = Date.parse(marker.date || 0)
        if (!Number.isFinite(ts)) return null
        const position = this.positionForTimestamp(ts, { todayStart, msInDay })
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

    for (const dayGroup of groupsByDay.values()) {
      let oldestTopX = null
      const dayElbowX = crisp(dayGroup[0].position.x + runout)

      dayGroup.forEach((item, indexInDay) => {
        const { marker, position } = item
        const { x, y } = position
        const dy = Math.max(0, y - topY)
        const projectedTopX = x + runout + dy * leanRatio

        if (oldestTopX === null) {
          oldestTopX = crisp(projectedTopX)
        }

        const topX = oldestTopX + indexInDay

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        line.setAttribute('class', 'tag-line')
        line.setAttribute('d', [
          `M ${crisp(x)} ${crisp(y)}`,
          `L ${dayElbowX} ${crisp(y)}`,
          `L ${topX} ${topYCrisp}`,
        ].join(' '))
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
        }
      })
    }
  }

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

  hasTagMarkersInOldestDays() {
    if (!this.tagMarkers.length) return false

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msInDay = 24 * 60 * 60 * 1000
    const OLDEST_DAYS = 12
    const oldestStart = Math.max(0, this.days - OLDEST_DAYS)

    return this.tagMarkers.some((marker) => {
      const ts = Date.parse(marker.date || 0)
      if (!Number.isFinite(ts)) return false
      const pos = this.positionForTimestamp(ts, { todayStart, msInDay })
      return Boolean(pos && pos.dayIndex >= oldestStart)
    })
  }

  makeDot(entry, x, y, radius) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', x)
    circle.setAttribute('cy', y)
    circle.setAttribute('r', radius)
    circle.dataset.key = (entry.run_id || '') + '|' + (entry.date || '')
    const classes = ['dot', classForEntry(entry), entry.notes ? '' : 'no-notes']
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

  positionForTimestamp(ts, { todayStart, msInDay } = {}) {
    const now = new Date()
    const startOfToday = typeof todayStart === 'number'
      ? todayStart
      : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dayMs = typeof msInDay === 'number' ? msInDay : 24 * 60 * 60 * 1000

    const d = new Date(ts)
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const diffDays = Math.floor((startOfToday - dayStart) / dayMs)
    if (diffDays < 0 || diffDays >= this.days) return null

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

function classForConclusion(conclusion) {
  const normalized = (conclusion || '').toLowerCase()
  if (normalized === 'success') return ''
  if (['failure', 'failed', 'cancelled', 'timed_out'].includes(normalized)) return 'error'
  if (['action_required', 'neutral', 'stale'].includes(normalized)) return 'warn'
  return 'muted'
}

function formatHourLabel(hour) {
  const h = String(hour).padStart(2, '0')
  return `${h}:00`
}

function localDayKey(timestamp) {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
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

function loadTagMarkers() {
  if (!tagDataEl || !tagDataEl.textContent) return []

  try {
    const raw = JSON.parse(tagDataEl.textContent)
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

function loadOverflowTagMarker() {
  if (!overflowTagDataEl || !overflowTagDataEl.textContent) return null

  try {
    const raw = JSON.parse(overflowTagDataEl.textContent)
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

function annotateChanges(entries) {
  // entries are sorted newest-first; "lookback" walks forward in the array to go back in time.
  const sections = entries.map(entry => extractCurrentlyFailing(entry.notes || ''))
  const LOOKBACK = 10
  return entries.map((entry, idx) => {
    // For the following: "false" means: no notes at all were present
    /** @type {false | string} */
    const rawSection = sections[idx]
    // '' (falsy) meaqns: no currently failing section was present
    /** @type {string} */
    const section = rawSection || ''
    const nextSection = sections[idx + 1]
    const hasNext = typeof nextSection !== 'undefined' && nextSection !== false
    // Keep nextSection un-normalized so false (no notes) differs from '' (notes, no failing section).
    const failuresChanged = hasNext && section !== nextSection
    let glitchStartIndex = null

    // Find "glitches"; a glitch is a temporary, self-healing change in the failing section.
    if (failuresChanged && rawSection !== false) {
      const maxIdx = Math.min(sections.length - 1, idx + LOOKBACK)
      // 1. Try to find an entry with the same failing section
      let matchIndex = null
      for (let i = idx + 1; i <= maxIdx; i += 1) {
        const candidate = sections[i]
        if (candidate === false) continue
        if ((candidate || '') === section) {
          matchIndex = i
          break
        }
      }
      // 2. If we have one, the entry after that introduced the "glitch".
      if (matchIndex !== null) {
        const startIndex = matchIndex - 1
        if (startIndex >= idx && sections[startIndex] !== false) {
          glitchStartIndex = startIndex
        }
      }
    }

    return { ...entry, failuresChanged, glitchStartIndex }
  })
}

function extractCurrentlyFailing(notes) {
  if (!notes) return false
  const normalized = normalizeNotes(notes)
  const marker = '#### currently failing\n'
  const lower = normalized.toLowerCase()
  const idx = lower.indexOf(marker)
  if (idx === -1) return ''
  const slice = normalized.slice(idx + marker.length)
  return slice
    .split('\n')
    .map(line => line.trim())
    // Ignore trailing relative-date annotations like "[since 3 months]".
    .map(line => line.replace(/\s*\[[^\]]+\]\s*$/, ''))
    .filter(Boolean)
    .join('\n')
}

function extractPackagesCrawled(notes) {
  if (!notes) return null
  const match = /found\s+([\d,]+)\s+packages?\s+to\s+crawl/i.exec(notes)
  if (!match) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
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
