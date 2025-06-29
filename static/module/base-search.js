import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

export class BaseSearch {
  constructor(value, data, config = {}) {
    this.value = value;
    this.data = data;
    this.config = {
      // Default configuration
      filters: {
        author: { enabled: true, property: 'author' },
        ...config.filters
      },
      searchFields: ['name', 'description'],
      idField: 'name',
      ...config
    };
  }

  get() {
    let base = this.data;
    let value = this.value;

    // Apply configured filters
    for (const [filterName, filterConfig] of Object.entries(this.config.filters)) {
      if (!filterConfig.enabled) continue;

      const regex = new RegExp(`${filterName}:"([^"]+)"`, 'i');
      const match = value.match(regex);
      
      if (match) {
        base = this.applyFilter(base, filterConfig, match[1]);
        value = value.replace(match[0], '');
      }
    }

    if (!value.trim()) {
      return base;
    }

    return this.performSearch(base, value.trim());
  }

  applyFilter(data, filterConfig, filterValue) {
    const { property, type = 'includes' } = filterConfig;
    
    return data.filter(item => {
      const fieldValue = item[property] || '';
      
      switch (type) {
        case 'includes':
          return fieldValue.toLowerCase().includes(filterValue.toLowerCase());
        case 'array_includes':
          return fieldValue.toLowerCase().split(',').includes(filterValue.toLowerCase());
        case 'array_contains':
          return fieldValue.toLowerCase().split(',').some(val => 
            val.trim().includes(filterValue.toLowerCase())
          );
        default:
          return fieldValue.toLowerCase().includes(filterValue.toLowerCase());
      }
    });
  }

  performSearch(base, searchValue) {
    const minisrch = new minisearch({
      idField: this.config.idField,
      fields: this.config.searchFields,
      searchOptions: {
        boost: { [this.config.searchFields[0]]: 2 },
        fuzzy: 0.2,
        prefix: true
      }
    });

    minisrch.addAll(base);
    const results = minisrch.search(searchValue);
    const resultIds = results.map(r => r.id);
    const scores = results.reduce((acc, r) => {
      acc[r.id] = r.score;
      return acc;
    }, {});

    return base.filter(item => resultIds.includes(item[this.config.idField]))
      .sort((a, b) => scores[b[this.config.idField]] - scores[a[this.config.idField]]);
  }
}

// Specialized search classes
export class PackageSearch extends BaseSearch {
  constructor(value, data) {
    super(value, data, {
      filters: {
        author: { enabled: true, property: 'author' },
        label: { enabled: true, property: 'labels', type: 'array_contains' },
        platform: { enabled: true, property: 'platforms', type: 'array_contains' }
      }
    });
  }
}

export class LibrarySearch extends BaseSearch {
  constructor(value, data) {
    super(value, data, {
      filters: {
        author: { enabled: true, property: 'author' },
        python: { enabled: true, property: 'python_versions', type: 'array_contains' }
      }
    });
  }
} 