import { Card } from './card.js';
import { Data } from './data.js';

const form = document.forms.search;
const input = form.elements['search-field'];

let debounceTimeout;

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

function goSearch() {
  let value = input.value.toLowerCase();

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
    let base = data;

    const author = value.match(/author:"([^"]+)"/i);
    if (author) {
      base = base.filter(
        pkg => pkg.author.toLowerCase().includes(author[1].toLowerCase())
      );
      value = value.replace(author[0], '');
    }

    const label = value.match(/label:"([^"]+)"/i);
    if (label) {
      base = base.filter(
        pkg => pkg.labels.toLowerCase().includes(label[1].toLowerCase())
      );
      value = value.replace(label[0], '');
    }

    const platform = value.match(/platform:"([^"]+)"/i);
    if (platform) {
      base = base.filter(
        pkg => {
          if (!pkg.platforms) {
            return true;
          }
          return pkg.platforms.toLowerCase().includes(platform[1].toLowerCase())
        }
      );
      value = value.replace(platform[0], '');
    }

    const results = base.filter(
      pkg => pkg.name.toLowerCase().includes(value.trim())
    );

    results.slice(0,20).forEach(result => {
      const parent = document.createElement('li');
      parent.appendChild((new Card(result)).render());
      target_section.appendChild(parent);
    })
  });
}

input.form.onsubmit = (event) => {
  event.preventDefault();
  event.stopPropagation();
  clearTimeout(debounceTimeout);
  goSearch();
}

input.addEventListener('input', (event) => {
  clearTimeout(debounceTimeout);

  debounceTimeout = setTimeout(() => {
    goSearch();
  }, 1000); // 1000ms = 1 seconds
});
