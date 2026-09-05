import { Card } from './card.js'
import { Pagination } from './pagination.js'
import { Sort } from './sort.js'
import { Search } from './search.js'
import { sitePath } from './site-path.mjs'

const GRAVEYARD_SEARCH_MATCH_LIMIT = 10

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
  revertPath = sitePath('/')
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
    'installed-recent': 'Recent Installs',
    installed: 'All-time Installs',
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
  counter = this.section.querySelector(`[${this.attr}='counter']`)
  list = this.section.querySelector(`[${this.attr}='list']`)
  rangeIndicator = this.section.querySelector(`[${this.attr}='range']`)
  pageIndicator = this.section.querySelector(`[${this.attr}='page']`)
  st2List = this.section.querySelector(`[${this.attr}='st2-list']`)
  graveyardSection = this.section.querySelector(`[${this.attr}='graveyard']`)
  graveyardCounter = this.section.querySelector(`[${this.attr}='graveyard-counter']`)
  graveyardList = this.section.querySelector(`[${this.attr}='graveyard-list']`)

  constructor() {
    this.revertPath = onSearchPage()
      ? window.location.pathname
      : `${window.location.pathname}${window.location.search}`
  }

  updateHeading(count = null, timeRange = null, page = null) {
    if (count === null) {
      this.counter.innerText = 'Results'
    } else if (count === 1) {
      this.counter.innerText = '1 Result'
    } else {
      this.counter.innerText = `${count} Results`
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
    for (const node of this.timelineNodes) {
      node.remove()
    }
    this.timelineNodes = []
    for (const card of Array.from(this.list.children)) {
      card.remove()
    }
    this.st2List.replaceChildren()
    this.st2List.hidden = true
    this.graveyardList.replaceChildren()
    this.graveyardSection.hidden = true
  }

  // render the current page of results and pagination
  renderPage(items, page, st2Items = [], graveyardItems = []) {
    this.clear()

    this.pagination = new Pagination(this, items, page, this.section)
    const pageItems = this.pagination.calculate()

    const timeRangeLabel = this.buildTimeRangeLabel(pageItems)
    this.updateHeading(items.length + st2Items.length, timeRangeLabel, page)

    let assignedMainContent = false
    let installMode = 'standard'
    if (this.activeSortSelection === 'installed-recent') {
      installMode = 'recent'
    }
    else if (this.activeSortSelection === 'installed') {
      installMode = 'total'
    }

    const renderItems = (targetList, packages) => {
      for (const pkg of packages) {
        const li = document.createElement('li')
        const fragment = (new Card(pkg, null, installMode)).render()
        if (!assignedMainContent) {
          this.assignMainContentTarget(fragment)
          assignedMainContent = true
        }
        li.appendChild(fragment)
        targetList.appendChild(li)
      }
    }

    const timeline = this.buildTimeline(pageItems)
    if (timeline) {
      this.renderTimeline(timeline, renderItems)
    }
    else {
      renderItems(this.list, pageItems)
    }

    if (this.pagination.isLastPage) {
      if (st2Items.length > 0) {
        const firstSt2Anchor = this.renderSt2Matches(st2Items)
        if (!assignedMainContent && firstSt2Anchor) {
          this.assignMainContentAnchor(firstSt2Anchor)
          assignedMainContent = true
        }
      }

      if (graveyardItems.length > 0) {
        const hasPackageMatches = items.length > 0 || st2Items.length > 0
        const firstGraveyardAnchor = this.renderGraveyardMatches(graveyardItems, hasPackageMatches)
        if (!assignedMainContent && firstGraveyardAnchor) {
          this.assignMainContentAnchor(firstGraveyardAnchor)
        }
      }
    }

    this.pagination.render()
  }

  renderSt2Matches(packages) {
    let firstAnchor = null
    for (const pkg of packages) {
      const item = document.createElement('li')
      const anchor = this.st2MatchLink(pkg)
      item.append(anchor, this.st2MatchReason())
      this.st2List.appendChild(item)
      firstAnchor ??= anchor
    }

    this.st2List.hidden = false
    return firstAnchor
  }

  st2MatchLink(pkg) {
    const href = sitePath(`/packages/${encodeURIComponent(pkg.name)}`)
    return this.supplementaryMatchLink(pkg, href)
  }

  st2MatchReason() {
    const marker = document.createElement('span')
    marker.className = 'st2-search-reason'
    marker.textContent = 'ST2'
    marker.title = 'Outdated package for Sublime Text 2'
    return marker
  }

  renderGraveyardMatches(packages, hasRegularMatches) {
    const noun = packages.length === 1 ? 'match' : 'matches'
    const prefix = hasRegularMatches ? 'Also ' : ''
    this.graveyardCounter.replaceChildren(
      document.createTextNode(`${prefix}${packages.length} ${noun} in our `),
      this.graveyardPageLink(),
    )

    let firstAnchor = null
    for (const pkg of packages) {
      const item = document.createElement('li')
      const anchor = this.graveyardMatchLink(pkg)
      item.append(anchor, this.graveyardMatchReason())
      this.graveyardList.appendChild(item)
      firstAnchor ??= anchor
    }

    this.graveyardSection.hidden = false
    return firstAnchor
  }

  graveyardPageLink() {
    const anchor = document.createElement('a')
    anchor.href = sitePath('/graveyard')
    anchor.textContent = 'graveyard'
    return anchor
  }

  graveyardMatchLink(pkg) {
    const href = pkg.graveyard_only
      ? sitePath(`/graveyard#${pkg.graveyard_id}`)
      : sitePath(`/packages/${encodeURIComponent(pkg.name)}`)
    return this.supplementaryMatchLink(pkg, href)
  }

  supplementaryMatchLink(pkg, href) {
    const anchor = document.createElement('a')
    anchor.className = 'supplementary-search-name'
    anchor.href = href
    appendPackageName(anchor, pkg.name)
    return anchor
  }

  graveyardMatchReason() {
    const marker = document.createElement('span')
    marker.className = 'graveyard-search-reason'
    marker.textContent = '+'
    marker.title = 'Removed from Package Control'
    return marker
  }

  // scroll to top of results after updating the list "in place"
  scrollUp(all_the_way = true) {
    const target = all_the_way ? document.forms.search : this.counter
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
    if (anchor) {
      this.assignMainContentAnchor(anchor)
    }
  }

  assignMainContentAnchor(anchor) {
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
    const target = queryString_ ? sitePath('/' + queryString_) : this.revertPath
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
      this.filterStateUpdater?.(query)
      this.updateHeading()
      this.revertToNormal()
      return
    }

    const allSearchResults = hasQuery
      ? this.search.search(query)
      : this.search.all()
    const { searchResults, st2Results, graveyardResults } = splitSearchResults(allSearchResults, hasQuery)

    this.filterStateUpdater?.(query, [...searchResults, ...st2Results])

    let effectiveSort = sortBy
    if (usingWildcard && effectiveSort.startsWith('author')) {
      effectiveSort = 'list-' + effectiveSort
    }
    const sortedResults = Sort.sort(searchResults, effectiveSort)

    // hide the normal homepage and show results
    this.switchToResults()

    // render results with pagination
    this.renderPage(sortedResults, page, st2Results, graveyardResults)

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

export function splitSearchResults(results, hasQuery) {
  const searchResults = results.filter(pkg => !pkg.graveyard && !pkg.outdated)
  const st2Results = results.filter(pkg => pkg.outdated && !pkg.removed)
  const showGraveyard = hasQuery && results.length < GRAVEYARD_SEARCH_MATCH_LIMIT
  const graveyardResults = showGraveyard
    ? results.filter(pkg => pkg.graveyard)
    : []
  return { searchResults, st2Results, graveyardResults }
}

function appendPackageName(parent, name) {
  const value = String(name)
  let start = 0

  for (let index = 1; index < value.length; index += 1) {
    const previous = value[index - 1]
    const current = value[index]
    const next = value[index + 1] ?? ''
    const breaksBeforeUppercase = /[a-z\d]/.test(previous) && /[A-Z]/.test(current)
    const breaksBeforeWord = /[A-Z]/.test(previous) && /[A-Z]/.test(current) && /[a-z]/.test(next)
    if (!breaksBeforeUppercase && !breaksBeforeWord) continue

    parent.append(document.createTextNode(value.slice(start, index)), document.createElement('wbr'))
    start = index
  }

  parent.appendChild(document.createTextNode(value.slice(start)))
}

function onSearchPage() {
  const currentParams = new URLSearchParams(window.location.search)
  return (
    currentParams.has('q')
    || currentParams.has('sort')
    || currentParams.has('page')
  )
}
