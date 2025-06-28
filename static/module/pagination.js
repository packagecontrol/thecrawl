export class Pagination {
  constructor(items, page, parent) {
    this.items = items;
    this.currentPage = page;
    this.totalPages = 0;
    this.itemsPerPage = 24;
    this.parent = parent;
  }

  // calculate pagination and result the items of the current page
  calculate() {
    this.totalPages = Math.ceil(this.items.length / this.itemsPerPage);
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = Math.min(startIndex + this.itemsPerPage, this.items.length);

    return this.items.slice(startIndex, endIndex);
  }

  render() {
    if (this.totalPages < 2) {
      return;
    }

    const pagination = document.createElement('div');
    pagination.className = 'pagination';

    // info text
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, this.items.length);
    const info = document.createElement('div');
    info.className = 'pagination-info';
    info.textContent = `Showing ${startItem}-${endItem} of ${this.items.length} packages`;
    pagination.appendChild(info);

    // controls
    const controls = document.createElement('div');
    controls.className = 'button-group pagination-controls';

    // previous button
    if (this.currentPage > 1) {
      const prevBtn = this.createPageButton('Previous', this.currentPage - 1);
      controls.appendChild(prevBtn);
    }

    // page numbers
    const pageNumbers = this.getPageNumbers(this.currentPage, this.totalPages);
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

    // next button
    if (this.currentPage < this.totalPages) {
      const nextBtn = this.createPageButton('Next', this.currentPage + 1);
      controls.appendChild(nextBtn);
    }

    pagination.appendChild(controls);
    this.parent.appendChild(pagination);
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

        // trigger search with new page and scroll to the top of results
        this.parent.querySelector('h2').scrollIntoView();
        window.goSearch(query, sortBy, pageNum);
      });
    }

    return button;
  }

  getPageNumbers(currentPage, totalPages) {
    const pages = [];
    const maxVisible = 7; // maximum number of page buttons to show

    if (totalPages <= maxVisible) {
      // show all pages
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // show first page
      pages.push(1);

      if (currentPage <= 4) {
        // show pages 1-5 and ellipsis and last page
        for (let i = 2; i <= 5; i++) {
        pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        // show first page, ellipsis, and last 5 pages
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) {
        pages.push(i);
        }
      } else {
        // show first page, ellipsis, current page ±1, ellipsis, last page
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
