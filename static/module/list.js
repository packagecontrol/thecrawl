import { Card } from './card.js';
import { Pagination } from './pagination.js';

export class List {
  // the section where we'll render search results
  getSection() {
    return document.querySelector('section[name="result"]');
  }

  // the list inside that section
  getList() {
    return this.getSection().querySelector('ul');
  }

  setCounter(count = null) {
    const counter = document.querySelector('h1 .counter');
    counter.innerText = count ?? counter.dataset.all;
  }

  // reveal search results and hide the static homepage
  switchToResults() {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = null;
      } else {
        section.style.display = 'none';
      }
    });
  }

  // revert to the static homepage
  revertToNormal() {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });

    this.setCounter();
  }

  // clear previous results and pagination ui
  clear() {
    this.getSection().querySelectorAll('li, .pagination').forEach(ui => {
      ui.remove();
    });
  }

  // render the current page of results and pagination
  renderPage(items, page) {
    this.clear();

    const pagination = new Pagination(items, page, this.getSection());

    // Render items for current page
    pagination.calculate().forEach(pkg => {
      const li = document.createElement('li');
      li.appendChild((new Card(pkg)).render());
      this.getList().appendChild(li);
    });

    pagination.render();
  }
}
