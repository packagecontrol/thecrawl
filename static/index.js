import { List } from './module/list.js'
import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

/**
 * Handle search features on the index and package pages.
 */

// Fetches and returns the search data from the index
async function fetchSearchData() {
  const res = await fetch('/search/index.json')
  if (!res.ok) throw new Error('Failed to fetch search data')
  return await res.json()
}
const data = await fetchSearchData()
const minisrch = new minisearch({
  idField: 'name',
  // search in these fields
  fields: ['name', 'description', 'author', 'platforms', 'labels'],
  // return all fields from the index
  storeFields: [
    'name',
    'description',
    'author',
    'stars',
    'installed',
    'created_at',
    'last_modified',
    'archived_at',
    'removed',
    'doa',
    'platforms',
    'labels',
    'permalink',
  ],
  searchOptions: {
    boost: { author: 2 },
    fuzzy: 0.2,
    prefix: true,
  },
})
minisrch.addAll(data)

const list = new List()

list.setMinisearch(minisrch)

const handleInput = () => {
  const query = input.value.toLowerCase().trim()
  const sortBy = sortSelect.value

  list.goSearch(query, sortBy)
}

const form = document.forms.search
const input = form.elements['q']
const sortSelect = form.elements['sort']
const url_search = window.location.search
const urlParams = new URLSearchParams(url_search)

// Handle initial page load
const query = urlParams.get('q') || ''
const sortBy = urlParams.get('sort')
const page = parseInt(urlParams.get('page')) || 1

input.value = query

// Only show search results if there's a query or explicit sort parameter
if (query || sortBy || urlParams.has('page')) {
  const effectiveSortBy = sortBy ?? 'relevance'
  sortSelect.value = effectiveSortBy
  list.goSearch(query.toLowerCase(), effectiveSortBy, page)
}

let debounceTimeout

// Handle form submission
input.form.onsubmit = (event) => {
  event.preventDefault()
  event.stopPropagation()
  clearTimeout(debounceTimeout)

  handleInput()
}

// Handle input changes (search as you type)
input.addEventListener('input', () => {
  clearTimeout(debounceTimeout)
  debounceTimeout = setTimeout(() => {
    handleInput()
  }, 300) // .3 seconds
})

// Handle sort dropdown changes
sortSelect.addEventListener('change', (event) => {
  const query = input.value.toLowerCase()
  const sortBy = event.target.value

  list.goSearch(query, sortBy)
})

// Handle browser back/forward navigation
window.addEventListener('popstate', (event) => {
  if (event.state && event.state.title) {
    document.title = event.state.title
  } else if (list && list.initialTitle) {
    document.title = list.initialTitle
  }
  const urlParams = new URLSearchParams(window.location.search)
  const query = urlParams.get('q') || ''
  const sortBy = urlParams.get('sort')
  const page = parseInt(urlParams.get('page')) || 1

  // Update form elements to reflect URL state
  input.value = query

  // Handle navigation
  if (query || sortBy || urlParams.has('page')) {
    const effectiveSortBy = sortBy || (query ? 'relevance' : 'name')
    sortSelect.value = effectiveSortBy
    list.goSearch(query, effectiveSortBy, page)
  } else if (window.location.pathname === '/') {
    list.revertToNormal()
  } else {
    history.go()
  }
})

// Add event delegation for search links
document.addEventListener('click', (event) => {
  // but only on the homepage ...
  if (!document.documentElement.classList.contains('home')) {
    return
  }

  // ... and only if you clicked an anchor with an href
  const target = event.target.closest('a')
  if (!target || !target.href) {
    return
  }

  const url = new URL(target.href, window.location.origin)
  const oldQuery = input.value
  const urlParams = new URLSearchParams(window.location.search)

  let newQuery = url.searchParams.get('q')

  // ... and only if you clicked something that would generate a "q" query
  if (newQuery === null) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (target.closest('form')) {
    // the shortcuts in the form should provide an additional narrowing of search,
    // not replace it
    if (oldQuery.includes('label:') && newQuery.includes('label:')) {
      newQuery = oldQuery.replace(/label:("[^"]+"|\S+)/, newQuery)
    } else if (oldQuery.includes('platform:') && newQuery.includes('platform:')) {
      newQuery = oldQuery.replace(/platform:("[^"]+"|\S+)/, newQuery)
    } else if (oldQuery.includes('author:') && newQuery.includes('author:')) {
      newQuery = oldQuery.replace(/author:("[^"]+"|\S+)/, newQuery)
    } else {
      newQuery = oldQuery + ' ' + newQuery
    }
  }

  input.value = newQuery.trim()

  const inputEvent = new Event('input', { bubbles: true })
  const changeEvent = new Event('change', { bubbles: true })
  input.dispatchEvent(inputEvent)
  input.dispatchEvent(changeEvent)

  list.scrollUp()
  list.goSearch(newQuery.toLowerCase(), urlParams.get('sort') ?? 'relevance', 1)
})
