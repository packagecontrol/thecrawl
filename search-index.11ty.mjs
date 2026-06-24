import { bust, search_index_json } from './eleventy.filters.mjs'

export default class SearchIndex {
  data() {
    return {
      permalink: `/${bust('static/search-index.json')}`,
    }
  }

  render({ collections, site }) {
    return search_index_json(collections.searchable_packages, {
      includeMagicDetails: site.rankingEasterEgg,
    })
  }
}
