export class Search {
  minisearch = null;

  // pass this a prepared minisearch instance: https://github.com/lucaong/minisearch
  constructor (minisearch = []) {
    this.minisearch = minisearch;
  }

  // process the search query string and return results
  search(value) {
    const queries = [];

    // first handle the author, label, and platform filters
    // these have the form of type:value, or type:"value"

    // handle author filter
    const author = value.match(/author:"([^"]+)"|author:([^\s]+)/i)
    if (author) {
      const authorValue = author[1] || author[2]
      queries.push({
        queries: [authorValue],
        fields: ['author']
      })
      // author has been handled, remove this filter from the search string
      value = value.replace(author[0], '')
    }

    // handle label filter
    const label = value.match(/label:"([^"]+)"|label:([^\s]+)/i)
    if (label) {
      const labelValue = label[1] || label[2]
      queries.push({
        queries: [labelValue],
        fields: ['labels']
      })
      // label has been handled, remove this filter from the search string
      value = value.replace(label[0], '')
    }

    // handle platform filter
    const platform = value.match(/platform:"([^"]+)"|platform:([^\s]+)/i)
    if (platform) {
      const platformValue = platform[1] || platform[2]
      queries.push({
        queries: [platformValue],
        fields: ['platforms']
      })
      // platform has been handled, remove this filter from the search string
      value = value.replace(platform[0], '')
    }

    // if a value remains, add a free text search query across name, author and discription
    if (value.trim()) {
      queries.push({
        queries: value.trim().split(' '),
        fields: ['name', 'description', 'author']
      })
    }

    // search and then map results so we can easily use them for output
    const results = this.minisearch.search({
      queries,
      combineWith: 'AND'
    });

    // omit minisearch result internals
    // eslint-disable-next-line no-unused-vars
    return results.map(({score, /**/id, queryTerms, terms, match,/**/ ...rest}) => ({
      ...rest,
      score
    }));
  }
}

