import { Card } from './card.js';
import { Data } from './data.js';
import { List } from './list.js';
import { Search } from './search.js';

const data = await new Data().get();
const list = new List();

function goSearch(value) {
  const srch = new Search(value, data);
  const target_section = list.getTarget();

  // clear previous results
  list.clear();

  if (value.length < 1) {
    // there is no search query so revert to normal homepage
    list.reset();

    return;
  }

  const results = srch.get();

  list.setCounter(results.length);

  // hide the normal homepage and show results
  list.toggleSections();

  // start rendering results as you scroll
  list.startRendering(results);
}

const form = document.forms.search;
const input = form.elements['search-field'];
const url_search = window.location.search;

let debounceTimeout;

if (url_search) {
  // convert search urls (e.g. label or author links) to search input values
  input.value = decodeURI(url_search).replace('?', '').replace('=', ':');
  goSearch(input.value.toLowerCase());
}

input.form.onsubmit = (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(debounceTimeout);
  goSearch(input.value.toLowerCase());
}

input.addEventListener('input', (event) => {
  clearTimeout(debounceTimeout);

  debounceTimeout = setTimeout(() => {
    goSearch(input.value.toLowerCase());
  }, 1000); // 1000ms = 1 seconds
});
