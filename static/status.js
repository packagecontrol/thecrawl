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

/** @typedef {{ date: string, run_id?: string, notes?: string, conclusion?: string }} LogEntry */

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
    chart = new StatusChart(chartEl, onChartSelect)
  }

  bindControls()
  loadLogs().then((entries) => {
    logs = entries
    if (!logs.length) {
      renderEmptyState('No log entries found.')
      return
    }
    chart?.setData(logs)
    render(0)
  }).catch((err) => {
    console.error('Failed to load logs:', err)
    renderEmptyState('Failed to load logs. Please try again later.')
  })
}

function bindControls() {
  prevButton?.addEventListener('click', () => render(index + 1))
  nextButton?.addEventListener('click', () => render(index - 1))
  lastButton?.addEventListener('click', () => render(0))
}

const ASSET_URL = 'https://repackager.sublimetext.io/logs.json'

async function loadLogs() {
  const sources = [
    () => fetch(ASSET_URL, { cache: 'no-cache' }),
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

function onChartSelect(entry) {
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
  constructor(el, onSelect) {
    this.el = el
    this.onSelect = onSelect
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
    // vertical grid: one per day (at center)
    for (let i = 0; i < this.days; i++) {
      const x = crisp(this.padding.left + (this.days - 1 - i + 0.5) * this.barWidth)
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
    // horizontal lines every hour (lighter), stronger every 6 hours
    for (let h = 0; h <= 24; h += 1) {
      const y = crisp(this.yForHour(h))
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('x1', crisp(this.padding.left))
      line.setAttribute('x2', crisp(this.width - this.padding.right - 4))
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

      const cls = classFor(entry.conclusion)
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
    circle.setAttribute('r', this.radius)
    circle.dataset.key = (entry.run_id || '') + '|' + (entry.date || '')
    circle.setAttribute('class', `dot ${classFor(entry.conclusion)}`)
    circle.addEventListener('click', () => {
      if (typeof this.onSelect === 'function') {
        this.onSelect(entry)
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

function classFor(conclusion) {
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

function crisp(value) {
  return Math.round(value) + 0.5
}

init()
