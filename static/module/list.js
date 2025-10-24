import { Card } from './card.js'
import { Pagination } from './pagination.js'
import { Sort } from './sort.js'
import { Search } from './search.js'

/**
 * Manage the search results section.
 *
 * On search:
 * - Swap all registered "hideme" elements with the "result" section, and back.
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
  section = document.querySelector(`[${this.attr}='section']`)
  heading = document.querySelector(`[${this.attr}='heading']`)
  list = document.querySelector(`[${this.attr}='list']`)
  hideme = document.querySelectorAll(`[${this.attr}='hideme']`)

  constructor() {
    const initialParams = new URLSearchParams(window.location.search)
    initialParams.delete('q')
    initialParams.delete('sort')
    initialParams.delete('page')

    const serializedParams = initialParams.toString()
    this.revertPath = serializedParams
      ? `${window.location.pathname}?${serializedParams}`
      : window.location.pathname
  }

  setCounter(count = null) {
    if (count === null) {
      this.heading.innerText = 'Results'
    } else if (count === 1) {
      this.heading.innerText = '1 Result'
    } else {
      this.heading.innerText = `${count} Results`
    }
  }

  // reveal search results and hide any other sections
  switchToResults() {
    this.hideme.forEach((section) => {
      section.style.display = 'none'
    })

    this.section.style.display = null
  }

  // hide search results and reveal other sections
  revertToNormal() {
    this.clear()
    this.hideme.forEach((section) => {
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
    Array.from(this.list.children).forEach((card) => {
      card.remove()
    })
  }

  // render the current page of results and pagination
  renderPage(items, page) {
    this.clear()

    this.pagination = new Pagination(this, items, page, this.section)

    // Render items for current page
    this.pagination.calculate().forEach((pkg, index) => {
      const li = document.createElement('li')
      const fragment = (new Card(pkg)).render()
      if (index === 0) {
        this.assignMainContentTarget(fragment)
      }
      li.appendChild(fragment)
      this.list.appendChild(li)
    })

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

    const query = value.toLowerCase().trim()
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
      const currentParams = new URLSearchParams(window.location.search)
      const onSearchPage = (
        currentParams.has('q')
        || currentParams.has('sort')
        || currentParams.has('page')
      )
      if (!onSearchPage) {
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
      this.setCounter()
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

    this.setCounter(sortedResults.length)

    // hide the normal homepage and show results
    this.switchToResults()

    // render results with pagination
    this.renderPage(sortedResults, page)

    this.section.dispatchEvent(new Event('search-is-ready', { bubbles: true }))
  }
}
