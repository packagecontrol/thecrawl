import { Card } from './card.js'

const DEFAULT_PER_PAGE = 9
const pagerRegistry = []

const RECENT_PAGER_STYLES = `
  .pager-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;

    &.is-sticky {
      position: sticky;
      top: 0;
      z-index: 3;
      background: var(--background-2);
    }

    .pager-pagination {
      display: flex;
      align-items: center;
      align-self: end;
      gap: 1rem;
      font-size: 1.3rem;
      position: relative;
      top: 2px;

      .button-group {
        display: flex;
        gap: 0.2ex;
        font-size: 24px;
      }

      .button {
        background: transparent;

        &:enabled:hover,
        &:enabled:focus-visible {
          background: var(--background-4);
        }

        .pager-nav-symbol {
          display: inline-block;
          position: relative;
          top: -0.07em;
        }
      }

      .month-indicator {
        margin-left: 0.5rem;
        color: var(--foreground-3);
        font-size: 14px;
        align-self: center;
        padding-bottom: 10px;

        @media (max-width: 479px) {
          padding-bottom: 11px;
        }
      }
    }
  }
`

const HEADER_TEMPLATE_HTML = `
  <div class="pager-header">
    <slot class="h2-slot"></slot>
    <div class="pager-pagination">
      <span class="month-indicator"></span>
      <div class="button-group">
        <button type="button" class="button" data-control="first" aria-label="First page" title="First">
          <span class="pager-nav-symbol">«</span>
        </button>
        <button type="button" class="button" data-control="prev" aria-label="Previous page" title="Previous">
          <span class="pager-nav-symbol">‹</span>
        </button>
        <button type="button" class="button" data-control="next" aria-label="Next page" title="Next">
          <span class="pager-nav-symbol">›</span>
        </button>
      </div>
    </div>
  </div>
`

const style = document.createElement('style')
style.textContent = RECENT_PAGER_STYLES
document.head.appendChild(style)

const headerTemplate = document.createElement('template')
headerTemplate.innerHTML = HEADER_TEMPLATE_HTML.trim()

window.addEventListener('resize', recomputeStickinesOfPagers)
window.addEventListener('orientationchange', recomputeStickinesOfPagers)

function recomputeStickinesOfPagers() {
  pagerRegistry.forEach(
    pager => computeShouldStick(pager.section, () => pager.applyMobileHacks()))
}

function computeShouldStick(section, onChange) {
  // Compute the "mobile layout" not on screen size but on the height
  // of the 9 defaults cards compared to the window/client height.
  const list = section.querySelector('ul.grid')
  const listHeight = list.getBoundingClientRect().height
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0
  const stick = listHeight > viewportHeight

  const prev = section.dataset.shouldStick === 'true'
  if (prev != stick) {
    section.dataset.shouldStick = stick ? 'true' : 'false'
    if (onChange) onChange()
  }
  return stick
}

// Handles client-side paging for the pre-rendered sections on the home page
/** @template T */
class RecentPager {
  constructor(items, section, options = {}) {
    const {
      perPage = DEFAULT_PER_PAGE,
      queryParam,
      timestampField,
      shortHeading,
    } = options

    /** @type {T[]} */
    this.items = items

    this.section = section
    this.ul = section.querySelector('ul.grid')
    this.h2 = section.querySelector('h2')
    this.headingOriginalText = this.h2 ? this.h2.textContent : ''
    this.headingShortText = shortHeading
    this.perPage = perPage
    this.page = 1

    this.controls = null
    this.monthIndicator = null
    this.queryParam = queryParam
    /** @type {(item: T | null | undefined) => number} */
    this.timestampValue = item => item ? Number(item[timestampField] || 0) : 0

    pagerRegistry.push(this)
    section.dataset.shouldStick ?? computeShouldStick(section)
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

  renderControls() {
    const header = headerTemplate.content.firstElementChild.cloneNode(true)
    const slot = header.querySelector('slot.h2-slot')
    const pagination = header.querySelector('.pager-pagination')
    const month = pagination.querySelector('.month-indicator')
    const first = pagination.querySelector('[data-control="first"]')
    const prev = pagination.querySelector('[data-control="prev"]')
    const next = pagination.querySelector('[data-control="next"]')

    this.section.insertBefore(header, this.h2)
    slot.replaceWith(this.h2)

    const bindControl = (button, handler) => {
      if (!button.dataset.boundToPager) {
        button.dataset.boundToPager = 'true'
        button.addEventListener('click', (event) => {
          event.preventDefault()
          handler()
        })
      }
    }

    bindControl(first, () => this.goto(1))
    bindControl(prev, () => this.goto(this.page - 1))
    bindControl(next, () => this.goto(this.page + 1))

    this.controls = { first, prev, next }
    this.monthIndicator = month

    this.updateButtons()
    this.updateMonthIndicator()
    this.applyMobileHacks()
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

  /** @returns {string | null} */
  timestampFromUrl() {
    const url = new URL(window.location.href)
    return url.searchParams.get(this.queryParam)
  }

  /** @param {string | null} timestamp
   *  @returns {number} */
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

  /** @param {number} page
   *  @returns {number} */
  pageStartIndex(page) {
    return Math.max(0, (page - 1) * this.perPage)
  }

  /** @param {number} [page]
   *  @returns {string | null} */
  pageTimestamp(page = this.page) {
    if (page <= 1) return null
    const item = this.items[this.pageStartIndex(page)]
    return String(this.timestampValue(item))
  }

  updateHistory() {
    const timestamp = this.pageTimestamp()
    const url = new URL(window.location.href)
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
    const firstTimestamp = this.timestampValue(first)
    if (!firstTimestamp) return ''

    let lastTimestamp = 0
    // The current page could end with items without a valid
    // timestamp, walk backwards to find the last complete item.
    for (let idx = end - 1; idx >= start; idx--) {
      lastTimestamp = this.timestampValue(this.items[idx])
      if (lastTimestamp) break
    }

    const f = new Date(firstTimestamp * 1000)
    const l = new Date(lastTimestamp * 1000)

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
    // Only show from page 2 onwards
    let label = ''
    if (this.page > 1) {
      label = this.currentMonthLabel()
    }
    this.monthIndicator.style.display = label ? '' : 'none'
    this.monthIndicator.textContent = label
  }

  updateButtons() {
    const total = this.totalPages()
    const atStart = this.page <= 1
    this.controls.first.disabled = atStart
    this.controls.prev.disabled = atStart
    this.controls.next.disabled = this.page >= total
  }

  updateHeadingText() {
    if (!this.headingShortText) return
    const stickActive = this.section?.dataset.shouldStick === 'true'
    const text = this.page > 1 && stickActive ? this.headingShortText : this.headingOriginalText
    if (this.h2.textContent !== text) {
      this.h2.textContent = text
    }
  }

  applyMobileHacks() {
    const header = this.section.querySelector('.pager-header')
    const stick = this.section.dataset.shouldStick === 'true'
    if (stick) {
      header.classList.add('is-sticky')
      const headerHeight = Math.ceil(header.getBoundingClientRect().height || 0)
      this.section.style.scrollMarginTop = `${headerHeight}px`
    }
    else {
      header.classList.remove('is-sticky')
      this.section.style.scrollMarginTop = ''
    }

    this.updateHeadingText()
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
      li.appendChild((new Card(pkg, 'compact')).render())
      this.ul.appendChild(li)
    })

    // update controls state
    this.updateButtons()
    this.updateMonthIndicator()
    this.updateHeadingText()

    if (updateHistory) {
      this.updateHistory()
    }

    if (this.section.dataset.shouldStick === 'true') {
      const firstItem = this.ul.querySelector('li')
      if (firstItem) {
        const header = this.section.querySelector('.pager-header')
        const headerHeight = Math.ceil(header?.getBoundingClientRect()?.height || 0)
        const rect = firstItem.getBoundingClientRect()
        if (rect.top < headerHeight) {
          const scrollTop = window.scrollY
            ?? window.pageYOffset
            ?? document.documentElement.scrollTop
            ?? 0
          const target = Math.max(0, scrollTop + rect.top - headerHeight)
          window.scrollTo({ top: target, behavior: 'smooth' })
        }
      }
    }
  }
}

const pagerConfigs = [
  {
    section: 'recent',
    options: {
      queryParam: 'updated_after',
      timestampField: 'last_modified',
      shortHeading: 'Updated',
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
