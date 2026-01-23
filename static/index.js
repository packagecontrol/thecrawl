import { List } from './module/list.js'
import MiniSearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { createMinisearch } from './module/minisearch.js'

// Fetches and returns the search data from the index
async function fetchSearchData() {
  const staticBase = window.STATIC_BASE ?? '/static/'
  const res = await fetch(`${staticBase}search-index.json`)
  if (!res.ok) throw new Error('Failed to fetch search data')
  return await res.json()
}

const rawIndex = await fetchSearchData()
const packages = Array.isArray(rawIndex) ? rawIndex : (rawIndex.packages || [])
window.__LABEL_ICON_ALIASES__ = rawIndex.label_icon_aliases ?? {}
window.__LABEL_ICON_TINTS__ = rawIndex.label_icon_tints ?? {}

const minisrch = createMinisearch(MiniSearch, packages)

/**
 * Handle search features on the index and package pages.
 */

// Expose data for other modules and announce readiness
window.__SEARCH_DATA__ = packages
window.dispatchEvent(new CustomEvent('search:index-loaded', { detail: { data: packages } }))

const list = new List()
list.setMinisearch(minisrch)
list.setFilterStateUpdater(updateFilterButtonStates)

const form = document.forms.search
const input = form.elements['q']
const sortSelect = form.elements['sort']

/**
 * @typedef {Object} FilterButtonDescriptor
 * @property {HTMLAnchorElement} element The original filter button element.
 * @property {string} type The token prefix (e.g. label, platform, author).
 * @property {string} token Full token string extracted from the button href.
 */

/**
 * All filter buttons that can toggle search tokens, converted to metadata objects.
 * @type {FilterButtonDescriptor[]}
 */
const filterButtons = Array
  .from(form.querySelectorAll('.button-group.labels a.button[href*="?q="]'))
  .map(parseFilterButton)
  .filter(Boolean)

/**
 * Extract token metadata from a filter button anchor.
 * @param {HTMLAnchorElement} element
 * @returns {FilterButtonDescriptor | null}
 */
function parseFilterButton(element) {
  const url = new URL(element.href, window.location.origin)
  const token = url.searchParams.get('q')
  if (!token) {
    return null
  }
  const delimiterIndex = token.indexOf(':')
  if (delimiterIndex === -1) {
    return null
  }
  const type = token.slice(0, delimiterIndex)
  if (!type) {
    return null
  }

  return { element, type, token }
}

function updateFilterButtonStates(query) {
  if (!filterButtons.length) {
    return
  }

  const normalizedQuery = query.trim()
  const tokenCache = new Map()

  const getActiveTokens = (type) => {
    if (!tokenCache.has(type)) {
      const regex = new RegExp(`${type}:("[^"]+"|\\S+)`, 'g')
      const matches = normalizedQuery.match(regex) ?? []
      tokenCache.set(type, new Set(matches))
    }
    return tokenCache.get(type)
  }

  for (const { element, type, token } of filterButtons) {
    const activeTokens = getActiveTokens(type)
    if (activeTokens.has(token)) {
      element.classList.add('is-active')
    } else {
      element.classList.remove('is-active')
    }
  }
}

const syncFromUrl = ({ initialPageLoad = false }) => {
  const urlParams = new URLSearchParams(window.location.search)
  const query = urlParams.get('q') || ''
  const sortBy = urlParams.get('sort')
  const page = parseInt(urlParams.get('page')) || 1
  const effectiveSortBy = sortBy ?? 'relevance'

  if (initialPageLoad && !query && !sortBy) {
    return
  }

  input.value = query
  sortSelect.value = effectiveSortBy
  list.goSearch(query, effectiveSortBy, page)
}

function setSearchPending(pending) {
  if (form) {
    form.dataset.searchPending = pending ? 'true' : 'false'
  }
}

// Handle initial page load
setSearchPending(false)
syncFromUrl({ initialPageLoad: true })

const handleInput = () => {
  const query = input.value
  const sortBy = sortSelect.value
  setSearchPending(false)
  list.goSearch(query, sortBy)
}

let debounceTimeout

// Handle input changes (search as you type)
input.addEventListener('input', () => {
  clearTimeout(debounceTimeout)
  if (input.value.trim() == '') {
    handleInput()
  } else {
    setSearchPending(true)
    debounceTimeout = setTimeout(() => {
      handleInput()
    }, 300) // .3 seconds
  }
})

// Handle form submission
input.form.onsubmit = (event) => {
  event.preventDefault()
  event.stopPropagation()
  clearTimeout(debounceTimeout)

  handleInput()
}

// Handle sort dropdown changes
sortSelect.addEventListener('change', handleInput)

// Handle browser back/forward navigation
window.addEventListener('popstate', syncFromUrl)

// Add event delegation for search links
document.addEventListener('click', (event) => {
  // but only on the homepage ...
  if (!document.documentElement.classList.contains('home')) {
    return
  }

  // ... and only if you clicked an anchor with an href
  const target = event.target.closest('a')
  if (!target || !target.href || target.classList.contains('skip-link')) {
    return
  }

  const targetUrl = new URL(target.href, window.location.origin)
  // read possible query and sort from the clicked link
  let newQuery = targetUrl.searchParams.get('q')
  let newSort = targetUrl.searchParams.get('sort')

  // ... and only intercept when link carries either a query or a sort
  if (newQuery === null && newSort === null) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (newQuery !== null && target.closest('form')) {
    // the shortcuts in the form act as filters, toggling off when clicked twice
    const oldQuery = input.value
    const clickedQuery = newQuery
    const applyToggle = (type) => {
      if (!clickedQuery.includes(`${type}:`)) {
        return false
      }

      const tokenRegex = new RegExp(`${type}:("[^"]+"|\\S+)`)
      const newTokenMatch = clickedQuery.match(tokenRegex)
      if (!newTokenMatch) {
        return false
      }

      const newToken = newTokenMatch[0]
      const oldTokenMatch = oldQuery.match(tokenRegex)

      if (oldTokenMatch && oldTokenMatch[0] === newToken) {
        newQuery = oldQuery.replace(tokenRegex, '').replace(/\s{2,}/g, ' ').trim()
      } else if (oldTokenMatch) {
        newQuery = oldQuery.replace(tokenRegex, newToken)
      } else {
        newQuery = `${oldQuery} ${newToken}`.trim()
      }

      return true
    }

    if (!applyToggle('label') && !applyToggle('platform') && !applyToggle('author')) {
      newQuery = `${oldQuery} ${clickedQuery}`.trim()
    }
  }

  // if the clicked link has only a sort (no q param), clear query
  if (newQuery === null) {
    newQuery = ''
  }
  newQuery = newQuery.trim()
  input.value = newQuery

  // decide which sort to apply: from link if present, else current URL, else default
  const currentSearch = new URLSearchParams(window.location.search)
  newSort = newSort ?? currentSearch.get('sort') ?? 'relevance'
  sortSelect.value = newSort

  const inputEvent = new Event('input', { bubbles: true })
  const changeEvent = new Event('change', { bubbles: true })
  input.dispatchEvent(inputEvent)
  input.dispatchEvent(changeEvent)

  list.scrollUp()
  list.goSearch(newQuery, newSort, 1)
})
