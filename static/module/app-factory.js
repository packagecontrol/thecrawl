import { PackageData, LibraryData } from './base-data.js';
import { PackageList, LibraryList } from './base-list.js';
import { PackageSearch, LibrarySearch } from './base-search.js';
import { PackageCard, LibraryCard } from './base-card.js';

export class AppFactory {
  static create(type) {
    switch (type) {
      case 'packages':
        return {
          dataProvider: new PackageData(),
          cardRenderer: new PackageCard(),
          get listManager() {
            return new PackageList(this.cardRenderer);
          },
          searchProvider: (value, data) => new PackageSearch(value, data),
          defaultSort: 'relevance'
        };
      
      case 'libraries':
        return {
          dataProvider: new LibraryData(),
          cardRenderer: new LibraryCard(),
          get listManager() {
            return new LibraryList(this.cardRenderer);
          },
          searchProvider: (value, data) => new LibrarySearch(value, data),
          defaultSort: 'name'
        };
      
      default:
        throw new Error(`Unsupported app type: ${type}`);
    }
  }

  static async createApp(type) {
    const components = this.create(type);
    const data = await components.dataProvider.get();
    
    return {
      data,
      list: components.listManager,
      search: components.searchProvider,
      defaultSort: components.defaultSort
    };
  }
} 