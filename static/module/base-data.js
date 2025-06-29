export class BaseData {
  constructor(config = {}) {
    this.data = null;
    this.config = {
      endpoint: '/searchindex.json',
      contentType: 'application/json',
      ...config
    };
  }

  async get() {
    if (this.data) {
      return this.data;
    }

    try {
      const response = await fetch(this.config.endpoint);
      const contentType = response.headers.get("content-type") ?? '';

      if (!response.ok || !contentType.includes(this.config.contentType)) {
        throw new Error('bad response');
      }

      this.data = await response.json();
      return this.data;
    } catch (error) {
      console.error(`Error fetching data from ${this.config.endpoint}:`, error);
      return [];
    }
  }
}

// Specialized data classes
export class PackageData extends BaseData {
  constructor() {
    super({
      endpoint: '/packages/searchindex.json'
    });
  }
}

export class LibraryData extends BaseData {
  constructor() {
    super({
      endpoint: '/libraries/searchindex.json'
    });
  }
} 