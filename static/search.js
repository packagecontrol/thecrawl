import { Card } from './card.js';
import { Data } from './data.js';

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

function goSearch(value) {
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

    // handle author filter
    const author = value.match(/author:"([^"]+)"/i);
    if (author) {
      base = base.filter(
        pkg => pkg.author.toLowerCase().includes(author[1].toLowerCase())
      );

      // remove this filter from the search string
      value = value.replace(author[0], '');
    }

    // handle label filter
    const label = value.match(/label:"([^"]+)"/i);
    if (label) {
      base = base.filter(
        pkg => pkg.labels.toLowerCase().includes(label[1].toLowerCase())
      );

      // remove this filter from the search string
      value = value.replace(label[0], '');
    }

    // handle platform filter
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

      // remove this filter from the search string
      value = value.replace(platform[0], '');
    }

    // naively search package names for the remaining string (in any)
    const results = base.filter(
      pkg => pkg.name.toLowerCase().includes(value.trim())
    );

    results.slice(0,36).forEach(result => {
      const parent = document.createElement('li');
      parent.appendChild((new Card(result)).render());
      target_section.appendChild(parent);
    })
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
