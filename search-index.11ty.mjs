import { data_bust, search_index_json } from './eleventy.filters.mjs'

export default class SearchIndex {
  data() {
    return {
      permalink: `/${data_bust('data/search-index.json')}`,
    }
  }

  render({ collections, install_history }) {
    return search_index_json(collections.searchable_packages, install_history)
  }
}
