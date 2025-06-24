import { Card } from './card.js';

export class List {
  getButton() {
    return document.querySelector('section[name="result"] button');
  }

  getTarget() {
    return document.querySelector('section[name="result"] ul');
  }

  setCounter(count = null) {
    const counter = document.querySelector('h1 .counter');

    counter.innerText = count ?? counter.dataset.all;
  }

  toggleSections () {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') !== 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });
  }

  reset() {
    document.querySelectorAll('section').forEach(section => {
      if (section.getAttribute('name') === 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });

    this.setCounter();
  }

  clear () {
    document.querySelectorAll('section[name="result"] li').forEach(li => {
      li.remove();
    });
  }

  startRendering(items, batchSize = 24) {
    const total = items.length;
    let rendered = 0;

    const renderBatch = () => {
      const next = items.slice(rendered, rendered + batchSize);
      next.forEach(pkg => {
        const li = document.createElement('li');
        li.appendChild((new Card(pkg)).render());
        this.getTarget().appendChild(li);
      })
      rendered += next.length;

      if (rendered >= total) {
        this.getButton().style.display = 'none';
      } else {
        this.getButton().style.display = null;
      }
    }

    renderBatch();
    this.getButton().onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      renderBatch();
    }
  }
}
