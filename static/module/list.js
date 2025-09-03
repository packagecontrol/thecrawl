import { Card } from './card.js'
import { Pagination } from './pagination.js'
import { Sort } from './sort.js'
import { Search } from './search.js'

// utilities to manage the search result list
export class List {
  search = null
  initialPath = '/'
  initialTitle = document.title

  constructor() {
    this.initialPath = window.location.pathname
    this.initialTitle = document.title
  }

  // the section where we'll render search results
  getSection() {
    return document.querySelector('section[name="result"]')
  }

  // the list inside that section
  getList() {
    return this.getSection().querySelector('ul')
  }

  setCounter(count = null) {
    const header = this.getSection().querySelector('h1, h2')
    if (count === null) {
      header.innerText = header.dataset.default
    } else if (count === 1) {
      header.innerText = '1 Result'
    } else {
      header.innerText = `${count} Results`
    }
  }

  // reveal search results and hide the static homepage
  switchToResults() {
    document.querySelectorAll('section').forEach((section) => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = null
      }
      else {
        section.style.display = 'none'
      }
    })
  }

  // revert to the static homepage
  revertToNormal() {
    document.querySelectorAll('section').forEach((section) => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = 'none'
      }
      else {
        section.style.display = null
      }
    })

    this.setCounter()
  }

  // clear previous results and pagination ui
  clear() {
    this.getSection().querySelectorAll('li, .pagination').forEach((ui) => {
      ui.remove()
    })
  }

  // render the current page of results and pagination
  renderPage(items, page) {
    this.clear()

    const pagination = new Pagination(this, items, page, this.getSection())

    // Render items for current page
    pagination.calculate().forEach((pkg) => {
      const li = document.createElement('li')
      li.appendChild((new Card(pkg)).render())
      this.getList().appendChild(li)
    })

    pagination.render()
  }

  // scroll to top of results after updating the list "in place"
  scrollUp(all_the_way = true) {
    const el = all_the_way
      ? (document.forms.search)
      : (document.getElementById('result-header') || document.forms.search)
    const rect = el.getBoundingClientRect()
    const completelyAbove = rect.bottom < 0
    const completelyBelow = rect.top > window.innerHeight

    if (completelyAbove || completelyBelow) {
      el.scrollIntoView()
    }
  }

  setMinisearch(minisearch) {
    this.search = new Search(minisearch)
  }

  goSearch(value, sortBy = 'relevance', page = 1) {
    if (!this.search) {
      throw new Error('minisearch is not initialized')
    }

    // Update URL with search query, sort parameter, and page
    const params = new URLSearchParams()
    if (value.length > 0) {
      params.set('q', value)
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
      const title = value.length > 0 ? `Search — ${value}` : this.initialTitle
      history.pushState({ title }, '', target)
      document.title = title
    }

    // clear previous results
    this.clear()

    if (value.length < 1) {
      // no search query - revert to static homepage
      this.revertToNormal()
      return
    }

    const searchResults = this.search.search(value)

    // when not searching for strings, sorting magically switches to install number
    if (sortBy === 'relevance' && !this.search.stringSearch) {
      sortBy = 'installed'
    }
    const sortedResults = Sort.sort(searchResults, sortBy)

    this.setCounter(sortedResults.length)

    // hide the normal homepage and show results
    this.switchToResults()

    // render results with pagination
    this.renderPage(sortedResults, page)

    this.getSection().dispatchEvent(
      new Event('search-is-ready', { bubbles: true }),
    )
  }
}
