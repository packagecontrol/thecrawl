import { Search } from './search.js'

export class SimpleSearch {
  search = null
  input = null
  counter = document.querySelector('[data-list-target="counter"]')
  hiddenCounter = document.querySelector('[data-list-target="hidden"]')
  cards = []
  paramKey = 'q'
  initialTitle = document.title
  titlePrefix = null
  debounceTimeout = null
  cardFilter = null

  constructor(minisearch, cards, input, { titlePrefix = null, filters = {}, cardFilter = null } = {}) {
    this.search = new Search(minisearch, { filters })
    this.input = input
    this.cards = cards
    this.paramKey = this.input?.name || 'q'
    this.titlePrefix = titlePrefix
    this.cardFilter = cardFilter
  }

  init() {
    // Apply state from the initial URL (supports shared links)
    this.syncFromUrl()

    // Handle form submission
    if (this.input?.form) {
      this.input.form.onsubmit = (event) => {
        event.preventDefault()
        event.stopPropagation()
        clearTimeout(this.debounceTimeout)
        this.debounceTimeout = null
        this.handleInput()
      }
    }

    // Handle input changes (search as you type)
    this.input?.addEventListener('input', () => {
      clearTimeout(this.debounceTimeout)
      this.debounceTimeout = null
      if (this.input.value.trim() === '') {
        this.handleInput()
      } else {
        this.debounceTimeout = setTimeout(() => {
          this.handleInput()
          this.debounceTimeout = null
        }, 300) // .3 seconds
      }
    })

    window.addEventListener('popstate', () => this.syncFromUrl())
  }

  handleInput() {
    this.applySearch(this.input.value, { updateInput: false })
  }

  applySearch(rawQuery = '', { updateHistory = true, updateInput = false } = {}) {
    const normalizedQuery = typeof rawQuery === 'string'
      ? rawQuery.toLowerCase().trim()
      : ''

    if (updateInput && this.input) {
      this.input.value = normalizedQuery
    }

    if (!normalizedQuery) {
      this.revertToNormal()
    } else {
      this.renderSearch(normalizedQuery)
    }

    this.updateMainContentAnchor()
    this.updateTitle(normalizedQuery)

    if (updateHistory) {
      this.updateUrl(normalizedQuery)
    }

    this.dispatchSearchDone()
  }

  renderSearch(query) {
    const results = this.search.search(query).map(result => result.name)
    const visibleItems = new Set(results)
    let hidden = 0

    this.cards.forEach((card) => {
      const container = card.closest('li')
      if (!container) {
        return
      }
      const hiddenBySearch = !visibleItems.has(card.dataset.name)
      const hiddenByFilter = Boolean(this.cardFilter?.(card))
      if (!hiddenBySearch && hiddenByFilter) {
        hidden++
      }
      container.style.display = (hiddenBySearch || hiddenByFilter) ? 'none' : null
    })

    if (this.counter) {
      this.counter.innerText = results.length === 1 ? '1 Result' : `${results.length} Results`
    }

    if (this.hiddenCounter) {
      this.hiddenCounter.innerText = hidden > 0 ? `${hidden}` : ''
    }
  }

  revertToNormal() {
    let hidden = 0
    this.cards.forEach((card) => {
      const container = card.closest('li')
      if (container) {
        const hiddenByFilter = Boolean(this.cardFilter?.(card))
        container.style.display = hiddenByFilter ? 'none' : null
        if (hiddenByFilter) {
          hidden++
        }
      }
    })
    if (this.counter) {
      this.counter.innerText = 'List'
    }
    if (this.hiddenCounter) {
      this.hiddenCounter.innerText = hidden > 0 ? `${hidden}` : ''
    }
  }

  updateMainContentAnchor() {
    document.getElementById('main-content')?.removeAttribute('id')
    const firstVisibleCard = Array.from(this.cards)
      .map(card => card.closest('li'))
      .find((container) => {
        if (!container) {
          return false
        }
        return container.style.display !== 'none'
      })
    const mainAnchor = firstVisibleCard?.querySelector('a')
    if (mainAnchor) {
      mainAnchor.setAttribute('id', 'main-content')
    }
  }

  updateUrl(query) {
    const params = new URLSearchParams(window.location.search)
    if (query) {
      params.set(this.paramKey, query)
    } else {
      params.delete(this.paramKey)
    }

    const queryString = params.toString()
    const target = queryString ? `${window.location.pathname}?${queryString}` : window.location.pathname
    const current = `${window.location.pathname}${window.location.search}`

    if (current !== target) {
      history.pushState({ query }, '', target)
    }
  }

  syncFromUrl() {
    clearTimeout(this.debounceTimeout)
    this.debounceTimeout = null

    const params = new URLSearchParams(window.location.search)
    const queryFromUrl = params.get(this.paramKey) ?? ''

    this.applySearch(queryFromUrl, { updateHistory: false, updateInput: true })
  }

  updateTitle(query) {
    if (!this.titlePrefix) {
      return
    }
    if (query) {
      document.title = `${this.titlePrefix} — ${query}`
    } else {
      document.title = this.initialTitle
    }
  }

  dispatchSearchDone() {
    window.dispatchEvent(new Event('search:done'))
  }
}
