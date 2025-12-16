import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify/dist/purify.es.mjs'
import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js'

const notesEl = document.getElementById('status-notes')
const dateEl = document.querySelector('[data-status-date]')
const badgeEl = document.querySelector('[data-status-badge]')
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

init()

function init() {
  if (!notesEl || !dateEl || !badgeEl) {
    return
  }

  bindControls()
  loadLogs().then((entries) => {
    logs = entries
    if (!logs.length) {
      renderEmptyState('No log entries found.')
      return
    }
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

async function loadLogs() {
  const res = await fetch('/logs.json', { cache: 'no-cache' })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }
  /** @type {LogEntry[]} */
  const data = await res.json()
  return [...data].sort((a, b) => safeDate(b.date) - safeDate(a.date))
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
}

/**
 * @param {LogEntry} entry
 */
function updateHeading(entry) {
  const formatted = formatDate(entry.date)
  dateEl.textContent = formatted

  const conclusion = entry.conclusion || 'unknown'
  const badgeInfo = badgeFor(conclusion)

  badgeEl.textContent = badgeInfo.label
  badgeEl.className = `status-badge ${badgeInfo.className}`
}

/**
 * @param {LogEntry} entry
 */
function renderNotes(entry) {
  if (!entry.notes) {
    notesEl.innerHTML = '<p>No notes for this run.</p>'
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
