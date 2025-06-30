import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

// Fetches and returns the search data from searchindex.json
async function fetchSearchData() {
  const res = await fetch('/static/searchindex.json');
  if (!res.ok) throw new Error('Failed to fetch search data');
  return await res.json();
}
const data = await fetchSearchData();
const minisrch = new minisearch({
  idField: 'name',
  fields: ['name', 'description', 'author', 'platforms', 'labels'],
  // keep in sync with searchindex.json.njk
  storeFields: [
    'name', 'description', 'author', 'stars', 'platforms', 'labels', 'permalink'
  ],
  searchOptions: {
    boost: { author: 2 },
    fuzzy: 0.2,
    prefix: true
  }
});
minisrch.addAll(data);

export function search(value) {
  let queries = [];

  // handle author filter
  let author = value.match(/author:"([^"]+)"|author:([^\s]+)/i)
  if (author) {
    const authorValue = author[1] || author[2]
    queries.push({
      queries: [authorValue],
      fields: ['author']
    })
    // remove this filter from the search string
    value = value.replace(author[0], '')
  }

  // handle label filter
  let label = value.match(/label:"([^"]+)"|label:([^\s]+)/i)
  if (label) {
    const labelValue = label[1] || label[2]
    queries.push({
      queries: [labelValue],
      fields: ['labels']
    })
    value = value.replace(label[0], '')
  }

  // handle platform filter
  let platform = value.match(/platform:"([^"]+)"|platform:([^\s]+)/i)
  if (platform) {
    const platformValue = platform[1] || platform[2]
    queries.push({
      queries: [platformValue],
      fields: ['platforms']
    })
    value = value.replace(platform[0], '')
  }

  if (value) {
    queries.push({
      queries: value.trim().split(' '),
      fields: ['name', 'description', 'author']
    })
  }

  // search and then map results so we can easily use them for output
  let results = minisrch.search({
    queries,
    combineWith: 'AND'
  });
  // omit Minisearch result internals
  // eslint-disable-next-line no-unused-vars
  return results.map(({score, /**/id, queryTerms, terms, match,/**/ ...rest}) => ({
    ...rest,
    score
  }));
}

