import { Data } from './module/data.js';
import { List } from './module/list.js';
import { Search } from './module/search.js';
import { Sort } from './module/sort.js';

const data = await new Data().get();
const list = new List();

function goSearch(value, sortBy = 'relevance', page = 1) {
  const srch = new Search(value, data);

  // Update URL with search query, sort parameter, and page
  const params = new URLSearchParams();
  if (value.length > 0) {
    params.set('q', value);
  }
  if (sortBy !== 'relevance') {
    params.set('sort', sortBy);
  }
  if (page > 1) {
    params.set('page', page);
  }

  const queryString = params.toString();
  const newUrl = queryString ? '?' + queryString : '/';

  // Only push state if URL is actually changing
  if (window.location.search !== (queryString ? '?' + queryString : '')) {
    history.pushState({}, '', newUrl);
  }

  // clear previous results
  list.clear();

  if (value.length < 1) {
    // no search query - revert to static homepage
    list.revertToNormal();
    return
  }

  const searchResults = srch.get();
  const sortedResults = Sort.sort(searchResults, sortBy);

  list.setCounter(sortedResults.length);

  // hide the normal homepage and show results
  list.switchToResults();

  // render results with pagination
  list.renderPage(sortedResults, page);
}

// Make goSearch globally accessible for pagination buttons
window.goSearch = goSearch;

const form = document.forms.search;
const input = form.elements['q'];
const sortSelect = form.elements['sort-field'];
const url_search = window.location.search;
const urlParams = new URLSearchParams(url_search);

let debounceTimeout;

// Handle initial page load
const query = urlParams.get('q') || '';
const sortBy = urlParams.get('sort');
const page = parseInt(urlParams.get('page')) || 1;

input.value = query;

// Only show search results if there's a query or explicit sort parameter
if (query || sortBy || urlParams.has('page')) {
  const effectiveSortBy = sortBy || (query ? 'relevance' : 'name');
  sortSelect.value = effectiveSortBy;
  goSearch(query.toLowerCase(), effectiveSortBy, page);
} else {
  // Show homepage with default sort option selected
  sortSelect.value = 'name';
}

const handleInput = () => {
  const query = input.value.toLowerCase().trim();
  const sortBy = sortSelect.value;

  if (query === '') {
    list.revertToNormal();
    // Update URL to remove search parameters
    if (window.location.pathname !== '/' || window.location.search !== '') {
      history.pushState({}, '', '/');
    }
  } else {
    goSearch(query, sortBy);
  }
}

// Handle form submission
input.form.onsubmit = (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(debounceTimeout);

  handleInput();
}

// Handle input changes (search as you type)
input.addEventListener('input', () => {
  clearTimeout(debounceTimeout);

  debounceTimeout = setTimeout(() => {
    handleInput();
  }, 300); // .3 seconds
});

// Handle sort dropdown changes
sortSelect.addEventListener('change', (event) => {
  const query = input.value.toLowerCase();
  const sortBy = event.target.value;

  goSearch(query, sortBy);
});

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const query = urlParams.get('q') || '';
  const sortBy = urlParams.get('sort');
  const page = parseInt(urlParams.get('page')) || 1;

  // Update form elements to reflect URL state
  input.value = query;

  // Handle navigation
  if (query || sortBy || urlParams.has('page')) {
    const effectiveSortBy = sortBy || (query ? 'relevance' : 'name');
    sortSelect.value = effectiveSortBy;
    goSearch(query, effectiveSortBy, page);
  } else {
    list.revertToNormal();
  }
});
