import { Card } from './card.js';

export class List {
  constructor() {
    this.itemsPerPage = 24;
    this.currentPage = 1;
    this.currentItems = [];
  }

  getSection() {
    return document.querySelector('section[name="result"]');
  }

  getList() {
    return this.getSection().querySelector('ul');
  }

  setCounter(count = null) {
    const counter = document.querySelector('h1 .counter');
    counter.innerText = count ?? counter.dataset.all;
  }

  toggleSections() {
    document.querySelectorAll('section').forEach(section => {
      const sectionName = section.getAttribute('name');
      if (sectionName === 'result') {
        // Reveal results
        section.style.display = null;
      } else {
        // Hide homepage sections (newest, recent) when showing results
        section.style.display = 'none';
      }
    });
  }

  reset() {
    document.querySelectorAll('section').forEach(section => {
      const sectionName = section.getAttribute('name');
      if (sectionName === 'result') {
        section.style.display = 'none';
      } else {
        section.style.display = null;
      }
    });

    this.setCounter();
    this.currentItems = [];
    this.currentPage = 1;
  }

  clear() {
    this.getList().querySelectorAll('li').forEach(li => {
      li.remove();
    });

    const existingPagination = this.getSection().querySelector('.pagination');
    if (existingPagination) {
      existingPagination.remove();
    }
  }

  renderPage(items, page = 1) {
    this.currentItems = items;
    this.currentPage = page;

    // Clear existing content
    this.clear();

    // Calculate pagination
    const totalPages = Math.ceil(items.length / this.itemsPerPage);
    const startIndex = (page - 1) * this.itemsPerPage;
    const endIndex = Math.min(startIndex + this.itemsPerPage, items.length);
    const pageItems = items.slice(startIndex, endIndex);

    // Render items for current page
    pageItems.forEach(pkg => {
      const li = document.createElement('li');
      li.appendChild((new Card(pkg)).render());
      this.getList().appendChild(li);
    });

    // Create pagination controls if needed
    if (totalPages > 1) {
      this.createPagination(totalPages, items.length);
    }
  }

  createPagination(totalPages, totalItems) {
    const pagination = document.createElement('div');
    pagination.className = 'pagination';

    // Info text
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, totalItems);
    const info = document.createElement('div');
    info.className = 'pagination-info';
    info.textContent = `Showing ${startItem}-${endItem} of ${totalItems} packages`;
    pagination.appendChild(info);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'button-group pagination-controls';

    // Previous button
    if (this.currentPage > 1) {
      const prevBtn = this.createPageButton('Previous', this.currentPage - 1);
      controls.appendChild(prevBtn);
    }

    // Page numbers
    const pageNumbers = this.getPageNumbers(this.currentPage, totalPages);
    pageNumbers.forEach(pageNum => {
      if (pageNum === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        controls.appendChild(ellipsis);
      } else {
        const pageBtn = this.createPageButton(pageNum, pageNum, pageNum === this.currentPage);
        controls.appendChild(pageBtn);
      }
    });

    // Next button
    if (this.currentPage < totalPages) {
      const nextBtn = this.createPageButton('Next', this.currentPage + 1);
      controls.appendChild(nextBtn);
    }

    console.log(controls.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        this.getSection().querySelector('h2').scrollIntoView();
      });
    }));

    pagination.appendChild(controls);
    this.getSection().appendChild(pagination);
  }

  createPageButton(text, pageNum, isActive = false) {
    const button = document.createElement('button');
    button.className = 'button';
    button.textContent = text;
    button.disabled = isActive;

    if (!isActive) {
      button.addEventListener('click', () => {
        const input = document.forms.search.elements['q'];
        const sortSelect = document.forms.search.elements['sort-field'];
        const query = input.value.toLowerCase();
        const sortBy = sortSelect.value;

        // Trigger search with new page
        window.goSearch(query, sortBy, pageNum);
      });
    }

    return button;
  }

  getPageNumbers(currentPage, totalPages) {
    const pages = [];
    const maxVisible = 7; // Maximum number of page buttons to show

    if (totalPages <= maxVisible) {
      // Show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first page
      pages.push(1);

      if (currentPage <= 4) {
        // Show pages 1-5 and ellipsis and last page
        for (let i = 2; i <= 5; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        // Show first page, ellipsis, and last 5 pages
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show first page, ellipsis, current page ±1, ellipsis, last page
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      }
    }

    return pages;
  }
}
