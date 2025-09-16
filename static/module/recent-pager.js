import { Card } from './card.js'

// Handles client-side paging for the pre-rendered "Recently updated" section
class RecentPager {
  constructor(items, section) {
    this.items = items
    this.section = section
    this.ul = section.querySelector('ul.grid')
    this.h2 = section.querySelector('h2')
    this.perPage = 9
    this.page = 1

    this.controls = null
    this.monthIndicator = null

    this.init()
  }

  init() {
    this.renderControls()
    this.applyColumnLayout()
    // Start on page 1; keep initial static render until user interacts
    // so no need to re-render immediately
  }

  totalPages() {
    return Math.max(1, Math.ceil(this.items.length / this.perPage))
  }

  // Ensure a semantic wrapper beside the H2 for controls
  ensureHeaderWrapper() {
    // If already wrapped, skip
    if (this.section.querySelector('.recent-header')) return

    const header = document.createElement('div')
    header.className = 'recent-header'
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
    this.section.querySelectorAll('.recent-pagination').forEach(n => n.remove())

    // Ensure we have a flex header row: [H2] [controls]
    this.ensureHeaderWrapper()

    const container = document.createElement('div')
    container.className = 'recent-pagination'
    container.style.cssText = 'display:flex; align-items:center; align-self:end; gap:0.5rem; font-size:1.3rem;'

    const controls = document.createElement('div')
    controls.className = 'button-group'
    controls.style.cssText = 'gap:0.2ex;font-size:24px'

    const first = document.createElement('button')
    first.className = 'button'
    first.textContent = '«'
    first.setAttribute('aria-label', 'First page of recently-updated')
    first.setAttribute('title', 'First')
    first.addEventListener('click', (e) => {
      e.preventDefault()
      this.goto(1)
    })

    const prev = document.createElement('button')
    prev.className = 'button'
    prev.textContent = '‹'
    prev.setAttribute('aria-label', 'Previous recently-updated page')
    prev.setAttribute('title', 'Previous')
    prev.addEventListener('click', (e) => {
      e.preventDefault()
      this.goto(this.page - 1)
    })

    const next = document.createElement('button')
    next.className = 'button'
    next.textContent = '›'
    next.setAttribute('aria-label', 'Next recently-updated page')
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
    const header = this.section.querySelector('.recent-header')
    header.appendChild(container)

    this.controls = { first, prev, next }
    this.monthIndicator = month
    this.updateButtons()
    this.updateMonthIndicator()
  }

  currentMonthLabel() {
    const start = (this.page - 1) * this.perPage
    const pkg = this.items[start]
    if (!pkg) return ''
    const t = Number(pkg.last_modified || 0) * 1000
    const d = new Date(t)
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' })
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

  // Switch the recent list from CSS grid to multi-column for top-to-bottom reading
  applyColumnLayout() {
    // configure columns on the list
    this.ul.style.display = 'block'
    this.ul.style.columnCount = '3'
    this.ul.style.columnGap = '1rem'

    // ensure existing prerendered items behave well in columns
    this.styleListItems()
  }

  styleListItems() {
    this.ul.querySelectorAll('li').forEach((li) => {
      this.decorateLi(li)
    })
  }

  decorateLi(li) {
    // keep items intact in a column and add vertical rhythm
    li.style.cssText = 'display: block; break-inside: avoid; margin: 0 0 1rem 0;'
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

  goto(page) {
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
      this.decorateLi(li)
      li.appendChild((new Card(pkg)).render())
      this.ul.appendChild(li)
    })

    // update controls state
    this.updateButtons()
    this.updateMonthIndicator()
  }
}

// Wait for search data to be ready, then create pager for recent section
function initWithData(data) {
  const section = document.querySelector('section[name="recent"]')
  if (!section) return

  const items = [...data]
    .sort((a, b) => (Number(b.last_modified || 0) - Number(a.last_modified || 0)))

  new RecentPager(items, section)
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
