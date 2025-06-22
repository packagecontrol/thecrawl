import { Card } from './card.js';
import { Search } from './search.js';
import { Data } from './data.js';

const data = await new Data().get();

function goSearch(value) {
  const srch = new Search(value, data);
  const target_section = document.querySelector('section[name="result"] ul');

  if (value.length < 1) {
    srch.reset();

    return;
  }

  const results = srch.get();

  document.querySelector('h1 .counter').innerText = results.length;

  srch.toggleSections();

  results.slice(0,36).forEach(result => {
    const parent = document.createElement('li');
    parent.appendChild((new Card(result)).render());
    target_section.appendChild(parent);
  });
}

const form = document.forms.search;
const input = form.elements['search-field'];
const url_search = window.location.search;

let debounceTimeout;

if (url_search) {
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
