import { Card } from './card.js'

const DEFAULT_PER_PAGE = 9

// Handles client-side paging for the pre-rendered sections on the home page
class RecentPager {
  constructor(items, section, options = {}) {
    const {
      perPage = DEFAULT_PER_PAGE,
      queryParam,
      timestampField,
    } = options

    this.items = items

    this.section = section
    this.ul = section.querySelector('ul.grid')
    this.h2 = section.querySelector('h2')
    this.perPage = perPage
    this.page = 1

    this.controls = null
    this.monthIndicator = null
    this.queryParam = queryParam
    this.timestampValue = item => item ? Number(item[timestampField] || 0) : 0

    this.init()
  }

  init() {
    this.renderControls()
    this.syncFromUrl()
    // Start on page 1; keep initial static render until user interacts
    // so no need to re-render immediately
  }

  totalPages() {
    return Math.max(1, Math.ceil(this.items.length / this.perPage))
  }

  // Ensure a semantic wrapper beside the H2 for controls
  ensureHeaderWrapper() {
    // If already wrapped, skip
    if (this.section.querySelector('.pager-header')) return

    const header = document.createElement('div')
    header.className = 'pager-header'
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:1rem;'

    // Insert header before the H2, then move H2 inside
    this.section.insertBefore(header, this.h2)
    header.appendChild(this.h2)
  }

  renderControls() {
    if (this.totalPages() <= 1) {
      return
    }
    // Remove existing controls if any
    this.section.querySelectorAll('.pager-pagination').forEach(n => n.remove())

    // Ensure we have a flex header row: [H2] [controls]
    this.ensureHeaderWrapper()

    const container = document.createElement('div')
    container.className = 'pager-pagination'
    container.style.cssText = 'display:flex; align-items:center; align-self:end; gap:0.5rem; font-size:1.3rem;'

    const controls = document.createElement('div')
    controls.className = 'button-group'
    controls.style.cssText = 'gap:0.2ex;font-size:24px'

    const first = document.createElement('button')
    first.className = 'button'
    first.textContent = '«'
    first.setAttribute('aria-label', 'First page')
    first.setAttribute('title', 'First')
    first.addEventListener('click', (e) => {
      e.preventDefault()
      this.goto(1)
    })

    const prev = document.createElement('button')
    prev.className = 'button'
    prev.textContent = '‹'
    prev.setAttribute('aria-label', 'Previous page')
    prev.setAttribute('title', 'Previous')
    prev.addEventListener('click', (e) => {
      e.preventDefault()
      this.goto(this.page - 1)
    })

    const next = document.createElement('button')
    next.className = 'button'
    next.textContent = '›'
    next.setAttribute('aria-label', 'Next page')
    next.setAttribute('title', 'Next')
    next.addEventListener('click', (e) => {
      e.preventDefault()
      this.goto(this.page + 1)
    })

    // Month indicator text (to the left of navigation)
    const month = document.createElement('span')
    month.className = 'month-indicator'
    month.style.cssText = 'margin-left:.5rem; color: var(--foreground-3); font-size: 14px; align-self:center;'
    month.textContent = this.currentMonthLabel()
    container.appendChild(month)

    controls.appendChild(first)
    controls.appendChild(prev)
    controls.appendChild(next)
    container.appendChild(controls)

    // place controls into header row, to the right of H2
    const header = this.section.querySelector('.pager-header')
    header.appendChild(container)

    this.controls = { first, prev, next }
    this.monthIndicator = month
    this.updateButtons()
    this.updateMonthIndicator()
  }

  syncFromUrl() {
    if (!this.items.length) return
    const timestamp = this.timestampFromUrl()
    const desiredPage = this.pageForTimestamp(timestamp)
    if (desiredPage > 1) {
      this.goto(desiredPage, { updateHistory: false })
    }
    this.updateHistory()
  }

  timestampFromUrl() {
    try {
      const url = new URL(window.location.href)
      return url.searchParams.get(this.queryParam)
    }
    catch {
      return null
    }
  }

  pageForTimestamp(timestamp) {
    if (!timestamp) return 1
    const value = String(timestamp)
    const total = this.totalPages()

    for (let page = 1; page <= total; page++) {
      if (this.pageTimestamp(page) === value) {
        return page
      }
    }

    const numeric = Number(value)
    if (!Number.isNaN(numeric)) {
      const index = this.items.findIndex(item => this.timestampValue(item) <= numeric)
      if (index !== -1) {
        const page = Math.floor(index / this.perPage) + 1
        return Math.min(total, Math.max(page, 1))
      }
    }

    return 1
  }

  pageStartIndex(page) {
    return Math.max(0, (page - 1) * this.perPage)
  }

  pageTimestamp(page = this.page) {
    if (page <= 1) return null
    const item = this.items[this.pageStartIndex(page)]
    return String(this.timestampValue(item))
  }

  updateHistory() {
    if (!window.history || typeof window.history.replaceState !== 'function') return

    const timestamp = this.pageTimestamp()
    let url
    try {
      url = new URL(window.location.href)
    }
    catch {
      return
    }

    if (timestamp) {
      url.searchParams.set(this.queryParam, timestamp)
    }
    else {
      url.searchParams.delete(this.queryParam)
    }

    window.history.replaceState(window.history.state, '', url)
  }

  currentMonthLabel() {
    // Show actual date range the page is showing
    const start = (this.page - 1) * this.perPage
    const end = Math.min(start + this.perPage, this.items.length)
    if (start >= end) return ''

    const first = this.items[start]
    const last = this.items[end - 1]

    const f = new Date(this.timestampValue(first) * 1000)
    const l = new Date(this.timestampValue(last) * 1000)

    const fY = f.getUTCFullYear(), fM = f.getUTCMonth()
    const lY = l.getUTCFullYear(), lM = l.getUTCMonth()

    const short = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleString('en-US', { month: 'short' })
    const long = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleString('en-US', { month: 'long' })

    // Same month
    if (fY === lY && fM === lM) {
      return `${long(fY, fM)} ${fY}`
    }

    // Same year, different months
    if (fY === lY) {
      return `${short(lY, lM)}-${short(fY, fM)} ${fY}`
    }

    // Different years
    return `${short(fY, fM)} ${fY} - ${short(lY, lM)} ${lY}`
  }

  updateMonthIndicator() {
    if (!this.monthIndicator) return
    // Only show from page 2 onwards
    if (this.page > 1) {
      this.monthIndicator.style.display = ''
      this.monthIndicator.textContent = this.currentMonthLabel()
    }
    else {
      this.monthIndicator.style.display = 'none'
    }
  }

  updateButtons() {
    const total = this.totalPages()
    const atStart = this.page <= 1
    this.controls.first.disabled = atStart
    this.controls.prev.disabled = atStart
    this.controls.next.disabled = this.page >= total

    // Visual cue for disabled state
    const { first, prev, next } = this.controls
    ;[first, prev, next].forEach((btn) => {
      btn.style.opacity = btn.disabled ? '0.4' : '1'
    })
  }

  goto(page, options = {}) {
    const { updateHistory = true } = options
    const total = this.totalPages()
    const newPage = Math.min(Math.max(1, page), total)
    if (newPage === this.page) return
    this.page = newPage

    // compute slice
    const start = (this.page - 1) * this.perPage
    const end = Math.min(start + this.perPage, this.items.length)
    const slice = this.items.slice(start, end)

    // replace list contents
    this.ul.querySelectorAll('li').forEach(li => li.remove())

    slice.forEach((pkg) => {
      const li = document.createElement('li')
      li.appendChild((new Card(pkg)).render())
      this.ul.appendChild(li)
    })

    // update controls state
    this.updateButtons()
    this.updateMonthIndicator()

    if (updateHistory) {
      this.updateHistory()
    }
  }
}

const pagerConfigs = [
  {
    section: 'recent',
    options: {
      queryParam: 'updated_after',
      timestampField: 'last_modified',
    },
  },
  {
    section: 'newest',
    options: {
      queryParam: 'created_after',
      timestampField: 'created_at',
    },
  },
]

// Wait for search data to be ready, then create pagers for the configured sections
function initWithData(data) {
  pagerConfigs.forEach((config) => {
    const section = document.querySelector(`section[name="${config.section}"]`)
    if (!section) return

    const field = config.options.timestampField
    const items = [...data]
      .sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0))

    new RecentPager(items, section, config.options)
  })
}

// Initialize immediately if data is already present (race-safe)
if (window.__SEARCH_DATA__) {
  initWithData(window.__SEARCH_DATA__)
}
else {
  document.addEventListener('search-data-ready', (evt) => {
    initWithData(evt.detail.data)
  })
}
