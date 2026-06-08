import { bust, search_index_json } from './eleventy.filters.mjs'

export default class SearchIndex {
  data() {
    return {
      permalink: `/${bust('static/search-index.json')}`,
    }
  }

  render({ collections }) {
    return search_index_json(collections.searchable_packages)
  }
}
