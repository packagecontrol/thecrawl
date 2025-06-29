import { AppFactory } from './module/app-factory.js';
import { Sort } from './module/sort.js';

// Detect app type based on current path
const isLibrariesPage = window.location.pathname.startsWith('/libraries');
const appType = isLibrariesPage ? 'libraries' : 'packages';

// Create app components using factory
const app = await AppFactory.createApp(appType);
const { data, list, search: createSearch, defaultSort } = app;

// Update counter for static pages
const counter = document.querySelector('.counter, h1 .counter');
if (counter) {
  counter.textContent = data.length;
  counter.setAttribute('data-all', data.length);
}

// Render initial data for libraries (packages handle this differently)
if (isLibrariesPage) {
  const initialSorted = Sort.sort(data, 'name');
  list.renderAll(initialSorted);
}

function goSearch(value, sortBy = defaultSort, page = 1) {
  const srch = createSearch(value, data);

  // Update URL with search query, sort parameter, and page
  const params = new URLSearchParams();
  if (value.length > 0) {
    params.set('q', value);
  }
  if (sortBy !== defaultSort) {
    params.set('sort', sortBy);
  }
  if (page > 1) {
    params.set('page', page);
  }

  const queryString = params.toString();
  const basePath = isLibrariesPage ? '/libraries/' : '/';
  const newUrl = queryString ? basePath + '?' + queryString : basePath;

  // Only push state if URL is actually changing
  if (window.location.search !== (queryString ? '?' + queryString : '')) {
    history.pushState({}, '', newUrl);
  }

  // clear previous results
  list.clear();

  if (value.length < 1) {
    // no search query - revert to homepage
    list.revertToNormal();
    
    // Re-render sorted data for libraries (packages handle this differently)
    if (isLibrariesPage) {
      const sortedData = Sort.sort(data, sortBy);
      list.renderAll(sortedData);
    }
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
  const effectiveSortBy = sortBy ?? defaultSort;
  sortSelect.value = effectiveSortBy;
  goSearch(query.toLowerCase(), effectiveSortBy, page);
}

const handleInput = () => {
  const query = input.value.toLowerCase().trim();

  if (query === '') {
    list.revertToNormal();
    
    // Re-render sorted data for libraries
    if (isLibrariesPage) {
      const sortedData = Sort.sort(data, sortSelect.value);
      list.renderAll(sortedData);
    }
    
    // Update URL to remove search parameters
    const basePath = isLibrariesPage ? '/libraries/' : '/';
    if (window.location.pathname !== basePath || window.location.search !== '') {
      history.pushState({}, '', basePath);
    }
  } else {
    goSearch(query, sortSelect.value);
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
    const effectiveSortBy = sortBy || (query ? defaultSort : defaultSort);
    sortSelect.value = effectiveSortBy;
    goSearch(query, effectiveSortBy, page);
  } else {
    list.revertToNormal();
    
    // Re-render sorted data for libraries
    if (isLibrariesPage) {
      const sortedData = Sort.sort(data, sortSelect.value || defaultSort);
      list.renderAll(sortedData);
    }
  }
});
