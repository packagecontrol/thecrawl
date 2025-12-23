import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'

const notesEl = document.getElementById('status-notes')
const dateEl = document.querySelector('[data-status-date]')
const badgeEl = document.querySelector('[data-status-badge]')
const badgeLabelEl = document.querySelector('[data-status-label]')
const chartEl = document.querySelector('[data-status-chart]')
/** @type {HTMLButtonElement | null} */
const prevButton = document.querySelector('[data-control="prev"]')
/** @type {HTMLButtonElement | null} */
const nextButton = document.querySelector('[data-control="next"]')
/** @type {HTMLButtonElement | null} */
const lastButton = document.querySelector('[data-control="last"]')

/** @typedef {{ date: string, run_id?: string, notes?: string, conclusion?: string, failuresChanged?: boolean }} LogEntry */

/** @type {LogEntry[]} */
let logs = []
let index = 0
/** @type {StatusChart | null} */
let chart = null

function init() {
  if (!notesEl || !dateEl || !badgeEl) {
    return
  }

  if (chartEl) {
    chart = new StatusChart(chartEl, {
      onSelect: renderEntry,
      onHover: showHoverPreview,
    })
    chartEl.addEventListener('mouseleave', restoreActiveEntry)
  }

  bindControls()
  bindKeyboard()
  loadLogs().then((entries) => {
    logs = annotateChanges(entries)
    if (!logs.length) {
      renderEmptyState('No log entries found.')
      return
    }
    chart?.setData(logs)
    render(resolveIndexFromUrl())
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
  if (!logs.length || typeof window === 'undefined') return 0
  const url = new URL(window.location.href)
  const runId = url.searchParams.get('run_id')
  if (!runId) return 0
  const found = logs.findIndex(entry => entry.run_id && String(entry.run_id) === runId)
  return found >= 0 ? found : 0
}

const ASSET_URL = 'https://repackager.sublimetext.io/logs.json'
const LOG_REFRESH_MS = 10 * 60 * 1000

async function loadLogs() {
  const sources = [
    () => fetch(ASSET_URL),
    () => fetch('/logs.json', { cache: 'no-cache' }),
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

  updateHeading(entry)
  renderNotes(entry)
  updateButtons()
  chart?.highlight(entry)
  updateUrl(entry)
}

function refreshLogs() {
  loadLogs().then((entries) => {
    if (!entries.length) return
    logs = annotateChanges(entries)
    chart?.setData(logs)
    render(resolveIndexFromUrl())
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
  badgeEl.textContent = '¯\\_(ツ)_/¯'
  badgeEl.className = 'status-badge status-badge-muted'
  notesEl.innerHTML = `<p>${message}</p>`

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
  return text.replace(/\r\n?/g, '\n')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
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
    this.dotLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.svg.appendChild(this.gridLayer)
    this.svg.appendChild(this.labelLayer)
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
        label.setAttribute('class', 'x-label')
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

  redrawDots() {
    this.points = []
    while (this.dotLayer.firstChild) this.dotLayer.firstChild.remove()

    if (!this.entries.length) return

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const msInDay = 24 * 60 * 60 * 1000

    const neutralNodes = []
    const otherNodes = []

    this.entries.forEach((entry) => {
      const ts = Date.parse(entry.date || 0)
      if (!Number.isFinite(ts)) return
      const d = new Date(ts)
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      const diffDays = Math.floor((todayStart - dayStart) / msInDay)
      if (diffDays < 0 || diffDays >= this.days) return

      const hour = d.getHours() + d.getMinutes() / 60
      const x = crisp(this.padding.left + (this.days - 1 - diffDays + 0.5) * this.barWidth)
      const y = this.yForHour(hour)
      const node = this.makeDot(entry, x, y)

      const cls = classForEntry(entry)
      const isNeutral = cls === '' || cls === 'muted'
      const target = isNeutral ? neutralNodes : otherNodes
      target.push({ entry, node })
    })

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

  makeDot(entry, x, y) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', x)
    circle.setAttribute('cy', y)
    const crawledPackages = extractPackagesCrawled(entry.notes || '')
    const MIN_RADIUS = 2
    const MAX_RADIUS = 3
    const radius = crawledPackages === null
      ? this.radius
      : clamp(
          MIN_RADIUS + (Math.min(crawledPackages, 500) / 500) * (MAX_RADIUS - MIN_RADIUS),
          MIN_RADIUS,
          MAX_RADIUS,
        )
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

function linkToRun(runId) {
  if (!runId) return ''
  const href = `https://github.com/packagecontrol/thecrawl/actions/runs/${runId}`
  return `<a href="${href}">logs</a>`
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
  const sections = entries.map(entry => extractCurrentlyFailing(entry.notes || ''))
  return entries.map((entry, idx) => {
    const section = sections[idx] || ''
    const nextSection = sections[idx + 1]
    const hasNext = typeof nextSection !== 'undefined' && nextSection !== false
    const failuresChanged = hasNext && section !== nextSection
    return { ...entry, failuresChanged }
  })
}

function extractCurrentlyFailing(notes) {
  if (!notes) return false
  const normalized = normalizeNotes(notes)
  const marker = '**currently failing**:\n'
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

function crisp(value) {
  return Math.round(value) + 0.5
}

init()
