import { Card } from './card.js'
import { Pagination } from './pagination.js'
import { Sort } from './sort.js'
import { Search } from './search.js'

/**
 * Manage the search results section.
 *
 * On search:
 * - Swap all registed "hideme" elements with the "result" section, and back.
 * - Insert pagination if needed.
 * - Update the heading with the number of results.
 * - .. oh and don't forget to render the results themselves :)
 */

export class List {
  search = null
  pagination = null
  initialPath = '/'
  initialTitle = document.title

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
    this.initialPath = window.location.pathname
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
    this.hideme.forEach((section) => {
      section.style.display = null
    })

    this.section.style.display = 'none'
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
    this.pagination.calculate().forEach((pkg) => {
      const li = document.createElement('li')
      li.appendChild((new Card(pkg)).render())
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

  goSearch(value, sortBy = 'relevance', page = 1) {
    if (!this.search) {
      throw new Error('minisearch is not initialized')
    }

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

    // Only push state if URL is actually changing
    if (window.location.search !== queryString_) {
      const target = '/' + queryString_
      const sortTitle = this.sortTitleMap[sortBy] ?? sortBy
      const title
        = usingWildcard
          ? `List by ${sortTitle}`
          : hasQuery
            ? `Search — ${query}`
            : this.initialTitle
      history.pushState({ title }, '', target)
      document.title = title
    }

    // clear previous results
    this.clear()

    if (!hasQuery && !usingWildcard) {
      // no search query and no alternate sort - revert to static homepage
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
    const sortedResults = Sort.sort(searchResults, effectiveSort)

    this.setCounter(sortedResults.length)

    // hide the normal homepage and show results
    this.switchToResults()

    // render results with pagination
    this.renderPage(sortedResults, page)

    this.section.dispatchEvent(new Event('search-is-ready', { bubbles: true }))
  }
}
