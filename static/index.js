import { List } from './module/list.js'
import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

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

  if (query === '') {
    list.revertToNormal()
    // Update URL to remove search parameters
    if (window.location.search !== '') {
      const target = list.initialPath
      const title = target === '/' ? 'Package Control R' : list.initialTitle
      history.pushState({ title }, '', target)
      document.title = title
    }
  }
  else {
    list.goSearch(query, sortSelect.value)
  }
}

const form = document.forms.search
const input = form.elements['q']
const sortSelect = form.elements['sort-field']
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

  if (input.value.length > 0) {
    input.classList.add('has-input')
  } else {
    input.classList.remove('has-input')
  }

  debounceTimeout = setTimeout(() => {
    handleInput()
  }, 300) // .3 seconds
})

input.addEventListener('blur', () => {
  if (input.value.length < 1) {
    input.form.classList.remove('overlay')
  }
})

document.querySelector('header [href="/#search-field"]').onclick = (event) => {
  event.preventDefault()
  event.stopPropagation()
  input.form.classList.add('overlay')
  input.form.querySelector('input').focus()
}

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

// Add event delegation for label links
document.addEventListener('click', (event) => {
  const target = event.target.closest('a')
  if (target && target.href) {
    const url = new URL(target.href, window.location.origin)
    const labelQuery = url.searchParams.get('q')
    if (labelQuery !== null) {
      event.preventDefault()
      event.stopPropagation()
      input.value = labelQuery
      sortSelect.value = 'relevance'
      list.scrollUp()
      list.goSearch(labelQuery.toLowerCase(), 'relevance', 1)
    }
  }
})
