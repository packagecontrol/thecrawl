import { List } from './module/list.js'
import MiniSearch from './vendor/minisearch/index.js'
import { createMinisearch } from './module/minisearch.js'
import {
  appendFilterToken,
  buildFeaturedLabels,
  buildLabelRecords,
  hasFilterValue,
  parseSingleFilterQuery,
  removeFilterValue,
} from './module/search-query.js'

const CURATED_FEATURED_LABELS = [
  'language syntax',
  'snippets',
  'linting',
  'auto-complete',
  'color scheme',
  'theme',
]
const DYNAMIC_LABEL_EXCLUSIONS = ['ST2', 'ST3', 'MIA', 'RIP', 'FAILING']
const MAX_FEATURED_LABELS = 6

// Fetches and returns the search data from the index
async function fetchSearchData() {
  const dataBase = window.DATA_BASE ?? '/data/'
  const res = await fetch(`${dataBase}search-index.json`)
  if (!res.ok) throw new Error('Failed to fetch search data')
  return await res.json()
}

let rawIndex
try {
  rawIndex = await fetchSearchData()
} catch (error) {
  window.dispatchEvent(new Event('search:error'))
  throw error
}
const packages = normalizeSearchPackages(rawIndex)
const allLabelRecords = buildLabelRecords(packages)
const knownLabels = new Set(
  allLabelRecords.flatMap(record => record.map(entry => entry.normalizedLabel)),
)
window.__LABEL_ICON_ALIASES__ = rawIndex.label_icon_aliases ?? {}
window.__LABEL_ICON_TINTS__ = rawIndex.label_icon_tints ?? {}
window.__LABEL_ICON_SECONDARY__ = new Set(rawIndex.label_icon_secondary ?? [])

const minisrch = createMinisearch(MiniSearch, packages)

function normalizeSearchPackages(rawIndex) {
  const packages = Array.isArray(rawIndex) ? rawIndex : (rawIndex.packages || [])
  if (!Array.isArray(packages[0])) {
    return packages
  }

  return packages.map(row => expandSearchPackage(row, rawIndex.install_history))
}

function expandSearchPackage(row, installHistory) {
  if (!Array.isArray(row)) {
    return row
  }

  const [
    name,
    description,
    author,
    stars,
    installs_total,
    installs_recent,
    first_seen,
    last_modified,
    magic_score,
    magic,
    platforms,
    platform_statement,
    labels,
    outdated,
    removed,
    archived_at,
  ] = row

  return {
    name,
    description,
    author,
    stars,
    installs_total,
    installs_recent,
    installs_recent_period: installPeriod(first_seen, installHistory),
    first_seen,
    last_modified,
    magic_score,
    magic: expandMagicBreakdown(magic),
    platforms,
    platform_statement,
    labels,
    ...(outdated ? { outdated: true } : {}),
    ...(removed ? { removed } : {}),
    ...(archived_at ? { archived_at } : {}),
  }
}

function installPeriod(firstSeen, history = {}) {
  if (history.window_start && firstSeen >= history.window_start) {
    return 'since added to Package Control'
  }

  return history.older_period || 'recorded'
}

function expandMagicBreakdown(values = []) {
  const [popularity, stars, freshness, longevity, recency, penalty] = values
  return { popularity, stars, freshness, longevity, recency, penalty }
}

/**
 * Handle search features on the index and package pages.
 */

// Expose data for other modules and announce readiness
window.__SEARCH_DATA__ = packages
window.dispatchEvent(new CustomEvent('search:index-loaded', { detail: { data: packages } }))

const list = new List()
list.setMinisearch(minisrch)
list.setFilterStateUpdater(updateSearchFilterUi)

const form = document.forms.search
const input = form.elements['q']
const sortSelect = form.elements['sort']
const featuredLabelsWrap = form.querySelector('.search-shortcuts .button-group.labels')

function updateSearchFilterUi(query, featuredPackages) {
  renderFeaturedLabels(query, featuredPackages)
  updateFilterButtonStates(query)
}

function renderFeaturedLabels(query, featuredPackages) {
  if (!featuredLabelsWrap) {
    return
  }

  const normalizedQuery = String(query ?? '')
  const hasQuery = normalizedQuery.trim().length > 0
  const scopedRecords = hasQuery && Array.isArray(featuredPackages)
    ? buildLabelRecords(featuredPackages)
    : allLabelRecords

  const { labels } = buildFeaturedLabels(normalizedQuery, scopedRecords, {
    defaults: CURATED_FEATURED_LABELS,
    maxTotal: MAX_FEATURED_LABELS,
    excludedLabels: DYNAMIC_LABEL_EXCLUSIONS,
    knownLabels,
  })

  featuredLabelsWrap.innerHTML = ''
  for (const label of labels) {
    const token = `label:"${label}"`
    const isActive = hasFilterValue(query, 'label', label)

    const li = document.createElement('li')
    const a = document.createElement('a')
    a.classList.add('button', 'label')
    a.dataset.filterBehavior = 'toggle'
    if (isActive) {
      a.classList.add('is-active')
    }
    a.href = '/?q=' + encodeURIComponent(token)
    a.appendChild(document.createTextNode(label))
    li.appendChild(a)
    featuredLabelsWrap.appendChild(li)
  }

  const li = document.createElement('li')
  const moreLink = document.createElement('a')
  moreLink.classList.add('button', 'label-more')
  moreLink.href = '/labels'
  moreLink.title = 'More labels'
  moreLink.appendChild(document.createTextNode('…'))
  li.appendChild(moreLink)
  featuredLabelsWrap.appendChild(li)
}

function updateFilterButtonStates(query) {
  const buttons = featuredLabelsWrap?.querySelectorAll('a.button[href*="?q="]') ?? []

  for (const button of buttons) {
    const token = new URL(button.href, window.location.origin).searchParams.get('q')
    const parsed = parseSingleFilterQuery(token)
    const isActive = parsed && hasFilterValue(query, parsed.type, parsed.value)
    button.classList.toggle('is-active', Boolean(isActive))
  }
}

const syncFromUrl = ({ initialPageLoad = false }) => {
  const urlParams = new URLSearchParams(window.location.search)
  const urlQuery = urlParams.get('q')
  const query = urlQuery ?? (initialPageLoad ? input.value : '')
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
updateSearchFilterUi(input.value)
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
  if (!document.documentElement.classList.contains('page-home')) {
    return
  }

  // ... and only if you clicked an anchor with an href
  const target = event.target.closest('a')
  if (!target || !target.href || target.classList.contains('skip-link')) {
    return
  }

  const targetUrl = new URL(target.href, window.location.origin)
  if (targetUrl.origin !== window.location.origin) {
    return
  }

  // read possible query and sort from the clicked link
  let newQuery = targetUrl.searchParams.get('q')
  let newSort = targetUrl.searchParams.get('sort')

  // ... and only intercept when link carries either a query or a sort
  if (newQuery === null && newSort === null) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  if (newQuery !== null) {
    const oldQuery = input.value
    const clicked = parseSingleFilterQuery(newQuery)

    if (clicked?.type === 'author') {
      newQuery = clicked.token
    } else if (clicked && ['label', 'platform'].includes(clicked.type)) {
      const isActive = hasFilterValue(oldQuery, clicked.type, clicked.value)
      const shouldToggle = target.dataset.filterBehavior === 'toggle'

      if (shouldToggle && isActive) {
        newQuery = removeFilterValue(oldQuery, clicked.type, clicked.value)
      } else if (!isActive) {
        newQuery = appendFilterToken(oldQuery, clicked.token)
      } else {
        newQuery = oldQuery
      }
    } else if (target.closest('form')) {
      newQuery = appendFilterToken(oldQuery, newQuery)
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

  clearTimeout(debounceTimeout)
  setSearchPending(false)
  window.dispatchEvent(new Event('search:expand'))

  list.scrollUp()
  list.goSearch(newQuery, newSort, 1)
})

window.dispatchEvent(new Event('search:ready'))
