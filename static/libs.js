import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'
import { Search } from './module/search.js';

const data = [];
const cards = document.querySelectorAll('[data-lib-name]');
cards.forEach(card => {
  data.push({
    name: card.dataset.libName,
    author: card.dataset.libAuthor,
  });
});

const minisrch = new minisearch({
  idField: 'name',
  fields: ['name', 'author'],
  storeFields: ['name'],
  searchOptions: {
    boost: { author: 2 },
    fuzzy: 0.2,
    prefix: true
  }
});
minisrch.addAll(data);

const search = new Search(minisrch);
const form = document.forms.search;
const input = form.elements['lib'];
const counter = document.querySelector('h1');
const handleInput = () => {
  const query = input.value.toLowerCase().trim();

  if (query === '') {
    cards.forEach(card => {
      card.closest('li').style.display = null;
    });
    counter.innerText = counter.dataset.all + ' Libraries';
    return;
  }

  const names = search.search(query).map(result => result.name);
  cards.forEach(card => {
    if (names.indexOf(card.dataset.libName) < 0) {
      card.closest('li').style.display = 'none';
    } else {
      card.closest('li').style.display = null;
    }
    if (names.length === 1) {
      counter.innerText = '1 Library';
    } else {
      counter.innerText = names.length + ' Libraries';
    }
  });
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

