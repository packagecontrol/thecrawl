import { Card } from './card.js';

export class List {
  constructor() {
    this.itemsPerPage = 24;
    this.currentPage = 1;
    this.currentItems = [];
  }

  getTarget(section = 'result') {
    return document.querySelector(`section[name="${section}"] ul`);
  }

  setCounter(count = null) {
    const counter = document.querySelector('h1 .counter');
    counter.innerText = count ?? counter.dataset.all;
  }

  toggleSections(activeSection = 'result') {
    document.querySelectorAll('section').forEach(section => {
      const sectionName = section.getAttribute('name');
      if (sectionName === activeSection) {
        section.style.display = null;
      } else if (sectionName === 'result') {
        section.style.display = 'none';
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

  clear(section = 'result') {
    // Remove all list items
    document.querySelectorAll(`section[name="${section}"] li`).forEach(li => {
      li.remove();
    });

    // Remove existing pagination
    const existingPagination = document.querySelector(`section[name="${section}"] .pagination`);
    if (existingPagination) {
      existingPagination.remove();
    }
  }

  renderPage(items, section = 'result', page = 1) {
    this.currentItems = items;
    this.currentPage = page;
    
    const target = this.getTarget(section);
    const sectionElement = document.querySelector(`section[name="${section}"]`);
    
    // Clear existing content
    this.clear(section);

    // Calculate pagination
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / this.itemsPerPage);
    const startIndex = (page - 1) * this.itemsPerPage;
    const endIndex = Math.min(startIndex + this.itemsPerPage, totalItems);
    const pageItems = items.slice(startIndex, endIndex);

    // Render items for current page
    pageItems.forEach(pkg => {
      const li = document.createElement('li');
      li.appendChild((new Card(pkg)).render());
      target.appendChild(li);
    });

    // Create pagination controls if needed
    if (totalPages > 1) {
      this.createPagination(sectionElement, page, totalPages, totalItems);
    }
  }

  createPagination(sectionElement, currentPage, totalPages, totalItems) {
    const pagination = document.createElement('div');
    pagination.className = 'pagination';

    // Info text
    const startItem = (currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(currentPage * this.itemsPerPage, totalItems);
    const info = document.createElement('div');
    info.className = 'pagination-info';
    info.textContent = `Showing ${startItem}-${endItem} of ${totalItems} packages`;
    pagination.appendChild(info);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'pagination-controls';

    // Previous button
    if (currentPage > 1) {
      const prevBtn = this.createPageButton('Previous', currentPage - 1);
      controls.appendChild(prevBtn);
    }

    // Page numbers
    const pageNumbers = this.getPageNumbers(currentPage, totalPages);
    pageNumbers.forEach(pageNum => {
      if (pageNum === '...') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        controls.appendChild(ellipsis);
      } else {
        const pageBtn = this.createPageButton(pageNum, pageNum, pageNum === currentPage);
        controls.appendChild(pageBtn);
      }
    });

    // Next button
    if (currentPage < totalPages) {
      const nextBtn = this.createPageButton('Next', currentPage + 1);
      controls.appendChild(nextBtn);
    }

    pagination.appendChild(controls);
    sectionElement.appendChild(pagination);
  }

  createPageButton(text, pageNum, isActive = false) {
    const button = document.createElement('button');
    button.className = `pagination-btn ${isActive ? 'active' : ''}`;
    button.textContent = text;
    button.disabled = isActive;
    
    if (!isActive) {
      button.addEventListener('click', () => {
        const input = document.forms.search.elements['search-field'];
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
