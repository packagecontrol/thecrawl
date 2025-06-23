import { Card } from './card.js';

export class List {
  observer = null;
  observed = null;

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
    this.observer.unobserve(this.observed);
    this.observer.disconnect();
  }

  clear () {
    document.querySelectorAll('section[name="result"] li').forEach(li => {
      li.remove();
    });
  }

  startRendering(items, batchSize = 12) {
    const total = items.length;
    this.observed = document.querySelector('footer');
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
        // stop observing
        this.observer.unobserve(this.observed);
      }
    }

    // start observing scroll: footer comes into viewport
    this.observer = new IntersectionObserver(renderBatch, {
      root: null,
      threshold: 0.2,
    });

    this.observer.observe(this.observed);
  }
}
