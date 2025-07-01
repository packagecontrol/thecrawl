import { Pagination } from './pagination.js';

export class BaseList {
  constructor(config = {}) {
    this.config = {
      // Default configuration
      selectors: {
        resultSection: 'section[name="result"]',
        resultList: 'section[name="result"] ul',
        allSection: 'section[name="all"]',
        allList: null, // Must be provided
        counter: '.counter'
      },
      itemsPerPage: 30,
      itemName: 'items', // for pagination text
      ...config
    };
    
    this.cardRenderer = config.cardRenderer;
    this.pagination = new Pagination();
  }

  getSection(type = 'result') {
    const selector = type === 'result' 
      ? this.config.selectors.resultSection 
      : this.config.selectors.allSection;
    return document.querySelector(selector);
  }

  getList(type = 'result') {
    const selector = type === 'result' 
      ? this.config.selectors.resultList 
      : this.config.selectors.allList;
    return document.querySelector(selector);
  }

  setCounter(count = null) {
    const counter = document.querySelector(this.config.selectors.counter);
    if (counter) {
      if (count !== null) {
        counter.textContent = count;
      } else {
        const totalCount = counter.getAttribute('data-all') || '0';
        counter.textContent = totalCount;
      }
    }
  }

  switchToResults() {
    const resultSection = this.getSection('result');
    const allSection = this.getSection('all');
    
    if (resultSection) resultSection.style.display = 'block';
    if (allSection) allSection.style.display = 'none';
  }

  revertToNormal() {
    const resultSection = this.getSection('result');
    const allSection = this.getSection('all');
    
    if (resultSection) resultSection.style.display = 'none';
    if (allSection) allSection.style.display = 'block';
    
    this.setCounter();
  }

  clear() {
    const resultsList = this.getList('result');
    const allList = this.getList('all');
    
    if (resultsList) resultsList.innerHTML = '';
    if (allList) allList.innerHTML = '';
  }

  renderAll(items) {
    const list = this.getList('all');
    if (!list) return;

    list.innerHTML = '';
    items.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = this.cardRenderer.render(item);
      list.appendChild(li);
    });
  }

  renderPage(items, page = 1) {
    const startIndex = (page - 1) * this.config.itemsPerPage;
    const endIndex = startIndex + this.config.itemsPerPage;
    const pageItems = items.slice(startIndex, endIndex);

    const list = this.getList('result');
    if (!list) return;

    list.innerHTML = '';
    pageItems.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = this.cardRenderer.render(item);
      list.appendChild(li);
    });

    // Add pagination if needed
    const totalPages = Math.ceil(items.length / this.config.itemsPerPage);
    if (totalPages > 1) {
      const paginationHtml = this.pagination.get(page, totalPages, this.config.itemName);
      list.insertAdjacentHTML('afterend', paginationHtml);
    }
  }
}

// Specialized list classes
export class PackageList extends BaseList {
  constructor(cardRenderer) {
    super({
      selectors: {
        resultSection: 'section[name="result"]',
        resultList: 'section[name="result"] ul',
        allSection: 'section[name="newest"], section[name="recent"]',
        allList: null, // Packages use different approach
        counter: 'h1 .counter'
      },
      itemsPerPage: 24,
      itemName: 'packages',
      cardRenderer
    });
  }

  // Override switchToResults to handle multiple sections
  switchToResults() {
    const resultSection = this.getSection('result');
    if (resultSection) resultSection.style.display = 'block';

    // Hide all homepage sections (newest and recent)
    document.querySelectorAll('section[name="newest"], section[name="recent"]').forEach(section => {
      section.style.display = 'none';
    });
  }

  // Override revertToNormal to handle multiple sections
  revertToNormal() {
    const resultSection = this.getSection('result');
    if (resultSection) resultSection.style.display = 'none';

    // Show all homepage sections (newest and recent)
    document.querySelectorAll('section[name="newest"], section[name="recent"]').forEach(section => {
      section.style.display = 'block';
    });
    
    this.setCounter();
  }

  // Override for packages special behavior
  clear() {
    const section = this.getSection('result');
    if (section) {
      section.querySelectorAll('li, .pagination').forEach(ui => ui.remove());
    }
  }

  renderPage(items, page) {
    this.clear();
    
    const section = this.getSection('result');
    const list = section?.querySelector('ul');
    if (!list) return;

    const pagination = new Pagination(items, page, section);

    pagination.calculate().forEach(item => {
      const li = document.createElement('li');
      li.appendChild(this.cardRenderer.render(item));
      list.appendChild(li);
    });

    pagination.render();
  }
}

export class LibraryList extends BaseList {
  constructor(cardRenderer) {
    super({
      selectors: {
        resultSection: 'section[name="result"]',
        resultList: 'section[name="result"] ul.libraries-list',
        allSection: 'section[name="all"]',
        allList: '#libraries-list',
        counter: '.counter'
      },
      itemsPerPage: 30,
      itemName: 'libraries',
      cardRenderer
    });
  }
} 