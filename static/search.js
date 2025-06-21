import { Card } from './card.js';
import { Data } from './data.js';

const form = document.forms.search;
const input = form.elements['search-field'];

function hideSections() {
  document.querySelectorAll('section').forEach(section => {
    if (section.getAttribute('name') !== 'result') {
      section.style.display = 'none';
    } else {
      section.style.display = null;
    }
  });
}

function restoreSections() {
  document.querySelectorAll('section').forEach(section => {
    if (section.getAttribute('name') === 'result') {
      section.style.display = 'none';
    } else {
      section.style.display = null;
    }
  });
}

input.addEventListener('change', (event) => {
  const value = event.target.value.toLowerCase();
  const target_section = document.querySelector('section[name="result"] ul');
  target_section.querySelectorAll('li').forEach(li => {
    li.remove();
  });

  if (value.length < 1) {
    restoreSections();
    return;
  }

  hideSections();

  (new Data()).get().then(data => {
    const results = data.filter(
      pkg => pkg.name.toLowerCase().includes(value)
    );
    results.slice(0,20).forEach(result => {
      const parent = document.createElement('li');
      parent.appendChild((new Card(result)).render());
      target_section.appendChild(parent);
    })
  });
});
