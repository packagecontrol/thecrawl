import { List } from './module/list.js';

const list = new List();

const handleInput = () => {
  const query = input.value.toLowerCase().trim();

  if (query === '') {
    list.revertToNormal();
    // Update URL to remove search parameters
    if (window.location.pathname !== '/' || window.location.search !== '') {
      history.pushState({}, '', '/');
    }
  } else {
    list.goSearch(query, sortSelect.value);
  }
}

const form = document.forms.search;
const input = form.elements['q'];
const sortSelect = form.elements['sort-field'];
const url_search = window.location.search;
const urlParams = new URLSearchParams(url_search);

// Handle initial page load
const query = urlParams.get('q') || '';
const sortBy = urlParams.get('sort');
const page = parseInt(urlParams.get('page')) || 1;

input.value = query;

// Only show search results if there's a query or explicit sort parameter
if (query || sortBy || urlParams.has('page')) {
  const effectiveSortBy = sortBy ?? 'relevance';
  sortSelect.value = effectiveSortBy;
  list.goSearch(query.toLowerCase(), effectiveSortBy, page);
}

let debounceTimeout;

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

  list.goSearch(query, sortBy);
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
    list.goSearch(query, effectiveSortBy, page);
  } else {
    list.revertToNormal();
  }
});

// Add event delegation for label links
document.addEventListener('click', (event) => {
  const target = event.target.closest('a');
  if (target && target.href) {
    const url = new URL(target.href, window.location.origin);
    const labelQuery = url.searchParams.get('q');
    if (labelQuery !== null) {
      event.preventDefault();
      event.stopPropagation();
      input.value = labelQuery;
      sortSelect.value = 'relevance';
      list.scrollUp();
      list.goSearch(labelQuery.toLowerCase(), 'relevance', 1);
    }
  }
});
