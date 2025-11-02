import { Card } from './card.js'
import { Pagination } from './pagination.js'
import { Sort } from './sort.js'
import { Search } from './search.js'

/**
 * Manage the search results section.
 *
 * On search:
 * - Swap all registered "main-content" sections with the search results section, and back.
 * - Insert pagination if needed.
 * - Update the heading with the number of results.
 * - .. oh and don't forget to render the results themselves :)
 */

export class List {
  search = null
  pagination = null
  // We freeze the current URL in `revertPath` if not `revertLocked` when
  // we transition to the search results page; see `goSearch`.
  revertPath = '/'
  revertLocked = false
  initialTitle = document.title
  restorableMainContent = document.getElementById('main-content')
  activeMainContentAnchor = null
  filterStateUpdater = null
  activeSortSelection = 'relevance'
  timelineNodes = []
  monthFormatter = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  quarterFormatter = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  monthShortFormatter = new Intl.DateTimeFormat('en', {
    month: 'short',
    timeZone: 'UTC',
  })

  sortTitleMap = {
    installed: 'Installs',
    stars: 'Stars',
    newest: 'Newest',
    oldest: 'Oldest',
    update: 'Recent Updates',
    name: 'Name (A-Z)',
    'name-desc': 'Name (Z-A)',
    author: 'Author (A-Z)',
    'author-desc': 'Author (Z-A)',
  }

  attr = 'data-list-target'
  mainContentSections = document.querySelectorAll(`[${this.attr}='main-content']`)
  section = document.querySelector(`[${this.attr}='search-results']`)
  heading = this.section.querySelector(`[${this.attr}='heading']`)
  list = this.section.querySelector(`[${this.attr}='list']`)
  rangeIndicator = this.section.querySelector(`[${this.attr}='range']`)
  pageIndicator = this.section.querySelector(`[${this.attr}='page']`)

  constructor() {
    this.revertPath = onSearchPage()
      ? window.location.pathname
      : `${window.location.pathname}${window.location.search}`
  }

  updateHeading(count = null, timeRange = null, page = null) {
    if (count === null) {
      this.heading.innerText = 'Results'
    } else if (count === 1) {
      this.heading.innerText = '1 Result'
    } else {
      this.heading.innerText = `${count} Results`
    }

    if (timeRange !== null) {
      this.rangeIndicator.textContent = timeRange
      this.rangeIndicator.removeAttribute('hidden')
    }
    else {
      this.rangeIndicator.textContent = ''
      this.rangeIndicator.setAttribute('hidden', '')
    }

    if (page > 1) {
      this.pageIndicator.textContent = `Page: ${page}`
      this.pageIndicator.removeAttribute('hidden')
    }
    else {
      this.pageIndicator.textContent = ''
      this.pageIndicator.setAttribute('hidden', '')
    }
  }

  // reveal search results and hide any other sections
  switchToResults() {
    this.mainContentSections.forEach((section) => {
      section.style.display = 'none'
    })

    this.section.style.display = null
  }

  // hide search results and reveal other sections
  revertToNormal() {
    this.clear()
    this.mainContentSections.forEach((section) => {
      section.style.display = null
    })
    this.section.style.display = 'none'
    this.restoreMainContentAnchor()
    // allow capturing a new revertPath on the next search activation
    this.revertLocked = false
  }

  // clear any pagination ui and previous results
  clear() {
    this.pagination?.clear()
    this.timelineNodes.forEach(node => node.remove())
    this.timelineNodes = []
    Array.from(this.list.children).forEach((card) => {
      card.remove()
    })
  }

  // render the current page of results and pagination
  renderPage(items, page) {
    this.clear()

    this.pagination = new Pagination(this, items, page, this.section)
    const pageItems = this.pagination.calculate()

    const timeRangeLabel = this.buildTimeRangeLabel(pageItems)
    this.updateHeading(items.length, timeRangeLabel, page)

    let assignedMainContent = false
    const renderItems = (targetList, packages) => {
      packages.forEach((pkg) => {
        const li = document.createElement('li')
        const fragment = (new Card(pkg)).render()
        if (!assignedMainContent) {
          this.assignMainContentTarget(fragment)
          assignedMainContent = true
        }
        li.appendChild(fragment)
        targetList.appendChild(li)
      })
    }

    const timeline = this.buildTimeline(pageItems)
    if (timeline) {
      this.renderTimeline(timeline, renderItems)
    }
    else {
      renderItems(this.list, pageItems)
    }

    this.pagination.render()
  }

  // scroll to top of results after updating the list "in place"
  scrollUp(all_the_way = true) {
    const target = all_the_way ? document.forms.search : this.heading
    const rect = target.getBoundingClientRect()
    const completelyAbove = rect.bottom < 0
    const completelyBelow = rect.top > window.innerHeight

    if (completelyAbove || completelyBelow) {
      target.scrollIntoView()
    }
  }

  setMinisearch(minisearch) {
    this.search = new Search(minisearch)
  }

  setFilterStateUpdater(callback) {
    this.filterStateUpdater = callback
  }

  assignMainContentTarget(fragment) {
    const anchor = fragment.querySelector('h3 a')
    if (!anchor) {
      return
    }

    const current = document.getElementById('main-content')
    if (current && current !== anchor) {
      this.restorableMainContent = current
      current.removeAttribute('id')
    }

    this.activeMainContentAnchor?.removeAttribute('id')
    anchor.setAttribute('id', 'main-content')
    this.activeMainContentAnchor = anchor
  }

  restoreMainContentAnchor() {
    this.activeMainContentAnchor?.removeAttribute('id')
    this.activeMainContentAnchor = null
    this.restorableMainContent?.setAttribute('id', 'main-content')
  }

  goSearch(value, sortBy = 'relevance', page = 1) {
    if (!this.search) {
      throw new Error('minisearch is not initialized')
    }

    this.filterStateUpdater?.(value)
    this.activeSortSelection = sortBy

    const query = value.trim()
    const hasQuery = query.length > 0
    const usingWildcard = !hasQuery && sortBy !== 'relevance'

    // Update URL with search query, sort parameter, and page
    const params = new URLSearchParams()
    if (hasQuery) {
      params.set('q', query)
    }
    if (sortBy !== 'relevance') {
      params.set('sort', sortBy)
    }
    if (page > 1) {
      params.set('page', page)
    }

    const queryString = params.toString()
    const queryString_ = queryString ? '?' + queryString : ''
    const target = queryString_ ? '/' + queryString_ : this.revertPath
    const isReverting = target === this.revertPath
    const currentPath = `${window.location.pathname}${window.location.search}`
    const sortTitle = this.sortTitleMap[sortBy] ?? sortBy
    const title
      = usingWildcard
        ? `List by ${sortTitle}`
        : hasQuery
          ? `Search — ${query}`
          : this.initialTitle

    // If we are transitioning from a non-search state into an active search,
    // freeze the current URL as the revert target.
    if (!isReverting && !this.revertLocked) {
      if (!onSearchPage()) {
        this.revertPath = `${window.location.pathname}${window.location.search}`
      }
      this.revertLocked = true
    }

    if (currentPath !== target) {
      history.pushState({ title }, '', target)
    }

    if (document.title !== title) {
      document.title = title
    }

    if (isReverting) {
      this.updateHeading()
      this.revertToNormal()
      return
    }

    const searchResults = hasQuery
      ? this.search.search(query)
      : this.search.all()

    // when not searching for strings, sorting magically switches to install number
    let effectiveSort = sortBy
    if (effectiveSort === 'relevance' && !this.search.stringSearch) {
      effectiveSort = 'installed'
    }
    if (usingWildcard && effectiveSort.startsWith('author')) {
      effectiveSort = 'list-' + effectiveSort
    }
    const sortedResults = Sort.sort(searchResults, effectiveSort)

    // hide the normal homepage and show results
    this.switchToResults()

    // render results with pagination
    this.renderPage(sortedResults, page)

    window.dispatchEvent(new Event('search:done'))
  }

  buildTimeline(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return null
    }

    if (!['newest', 'update'].includes(this.activeSortSelection)) {
      return null
    }

    const datedItems = items.map(pkg => ({
      pkg,
      date: this.extractTimelineDate(pkg),
    }))

    if (!datedItems.some(({ date }) => date)) {
      return null
    }

    for (const mode of ['month', 'quarter', 'year']) {
      const groups = this.collectTimelineGroups(datedItems, mode)
      if (groups.length === 0) {
        continue
      }
      if (mode === 'year' || groups.length <= 3) {
        return { mode, groups }
      }
    }

    return null
  }

  collectTimelineGroups(items, mode) {
    const groups = []
    let currentKey = null

    items.forEach(({ pkg, date }) => {
      const key = this.timelineKey(date, mode)
      const label = this.timelineLabel(date, mode)

      if (currentKey !== key) {
        currentKey = key
        groups.push({ key, label, items: [] })
      }

      groups[groups.length - 1].items.push(pkg)
    })

    return groups
  }

  renderTimeline(timeline, renderItems) {
    const { groups, mode } = timeline

    groups.forEach((group, index) => {
      if (index === 0) {
        renderItems(this.list, group.items)
      }
      else {
        const heading = this.createTimelineHeading(group.label, mode)
        const listElement = this.createTimelineList()
        this.section.appendChild(heading)
        this.section.appendChild(listElement)
        this.timelineNodes.push(heading, listElement)
        renderItems(listElement, group.items)
      }
    })
  }

  createTimelineHeading(label, mode) {
    const heading = document.createElement('p')
    heading.classList.add('timeline-break')
    heading.dataset.mode = mode
    heading.textContent = label
    return heading
  }

  createTimelineList() {
    const listElement = document.createElement('ul')
    listElement.className = this.list.className
    return listElement
  }

  extractTimelineDate(pkg) {
    const timestamp = (() => {
      if (this.activeSortSelection === 'update') {
        return this.parseTimestamp(pkg.last_modified)
      }
      if (this.activeSortSelection === 'newest') {
        return this.parseTimestamp(pkg.first_seen)
      }
      return null
    })()

    if (!timestamp) {
      return null
    }

    return new Date(timestamp * 1000)
  }

  parseTimestamp(raw) {
    if (raw === undefined || raw === null) {
      return null
    }
    const value = Number.parseInt(raw, 10)
    return Number.isFinite(value) && value > 0 ? value : null
  }

  timelineKey(date, mode) {
    if (!date) {
      return 'unknown'
    }

    const year = date.getUTCFullYear()
    if (mode === 'month') {
      return `${year}-${date.getUTCMonth()}`
    }
    if (mode === 'quarter') {
      const quarter = Math.floor(date.getUTCMonth() / 3)
      return `${year}-q${quarter}`
    }
    return String(year)
  }

  timelineLabel(date, mode) {
    if (!date) {
      return 'Unknown'
    }

    const year = date.getUTCFullYear()
    if (mode === 'month') {
      return this.monthFormatter.format(date)
    }

    if (mode === 'quarter') {
      const anchor = this.quarterAnchor(date)
      return this.quarterFormatter.format(anchor)
    }

    return String(year)
  }

  quarterAnchor(date) {
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const anchorMonth = Math.floor(month / 3) * 3 + 2
    return new Date(Date.UTC(year, anchorMonth, 1))
  }

  buildTimeRangeLabel(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return null
    }

    if (!['newest', 'update'].includes(this.activeSortSelection)) {
      return null
    }

    const dates = items
      .map(pkg => this.extractTimelineDate(pkg))
      .filter(Boolean)

    if (dates.length === 0) {
      return null
    }

    dates.sort((a, b) => a - b)

    const earliest = dates[0]
    const latest = dates[dates.length - 1]
    const earliestYear = earliest.getUTCFullYear()
    const latestYear = latest.getUTCFullYear()
    const yearSpan = latestYear - earliestYear

    if (yearSpan > 1) {
      return `${latestYear} - ${earliestYear}`
    }

    if (latestYear !== earliestYear) {
      const latestLabel = `${this.monthShortFormatter.format(latest)} ${latestYear}`
      const earliestLabel = `${this.monthShortFormatter.format(earliest)} ${earliestYear}`
      return `${latestLabel} - ${earliestLabel}`
    }

    const withinOneMonth = (
      `${earliest.getUTCFullYear()}-${earliest.getUTCMonth()}`
      === `${latest.getUTCFullYear()}-${latest.getUTCMonth()}`
    )
    if (withinOneMonth) {
      return this.monthFormatter.format(latest)
    }

    const earliestLabel = this.monthShortFormatter.format(earliest)
    const latestLabel = this.monthShortFormatter.format(latest)
    return `${latestLabel}-${earliestLabel} ${latestYear}`
  }
}

function onSearchPage() {
  const currentParams = new URLSearchParams(window.location.search)
  return (
    currentParams.has('q')
    || currentParams.has('sort')
    || currentParams.has('page')
  )
}
