import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

// Fetches and returns the search data from searchindex.json
async function fetchSearchData() {
  const res = await fetch('/static/searchindex.json');
  if (!res.ok) throw new Error('Failed to fetch search data');
  return await res.json();
}
const data = await fetchSearchData();

export function search(value) {
  let base = data;
  let queries = [];

  // handle author filter
  const author = value.match(/author:"([^"]+)"/i);
  if (author) {
    queries.push({
      queries: [author[1]],
      fields: ['author'] // restrict to author
    });
    // remove this filter from the search string
    value = value.replace(author[0], '');
  }

  // handle label filter
  const label = value.match(/label:"([^"]+)"/i);
  if (label) {
    queries.push({
      queries: [label[1]],
      fields: ['labels'] // restrict to author
    });

    // remove this filter from the search string
    value = value.replace(label[0], '');
  }

  // handle platform filter
  const platform = value.match(/platform:"([^"]+)"/i);
  if (platform) {
    queries.push({
      queries: [platform[1]],
      fields: ['platforms'] // restrict to author
    });
    // remove this filter from the search string
    value = value.replace(platform[0], '');
  }

  if (value) {
    queries.push({
      queries: value.trim().split(' '),
      fields: ['name', 'description', 'author']
    })
  }
  // use minisearch to find matches with some level of fuzziness
  // we sloppily reset the index each search
  // which is wasteful of cpu cycles I guess, but it seems fast enough :shrug:
  // https://github.com/lucaong/minisearch
  const minisrch = new minisearch({
    idField: 'name',
    fields: ['name', 'description', 'author', 'platforms', 'labels'],
    searchOptions: {
        boost: { author: 2 },
        fuzzy: 0.2,
        prefix: true
      }
  });

  // start with all data post label/author filtering
  minisrch.addAll(base);
  // search and then map results so we can easily use them for output
  let results = minisrch.search({
    queries,
    combineWith: 'AND'
  });

  const minikeys = results.map(mini => mini.id);
  const scores = results.reduce((acc, mini) => {
    acc[mini.id] = mini.score;
    return acc;
  }, {});

  // return matches sorted by their score according to minisearch
  // where a high score means a better match
  return base.filter(
    pkg => minikeys.indexOf(pkg.name) > -1
  ).sort((a,b) => {
    return scores[b.name] - scores[a.name];
  });
}

