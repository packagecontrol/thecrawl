import minisearch from 'https://cdn.jsdelivr.net/npm/minisearch@7.1.2/+esm'

export class Search {
  value = '';
  data = null;

  constructor(value, data) {
    this.value = value;
    this.data = data;
  }

  get() {
    let base = this.data;
    let value = this.value;

    // handle author filter
    const author = value.match(/author:"([^"]+)"/i);
    if (author) {
      base = base.filter(
        pkg => pkg.author.toLowerCase().includes(author[1].toLowerCase())
      );

      // remove this filter from the search string
      value = value.replace(author[0], '');
    }

    // handle label filter
    const label = value.match(/label:"([^"]+)"/i);
    if (label) {
      base = base.filter(pkg => {
        return pkg.labels.toLowerCase().split(',').indexOf(label[1].toLowerCase()) > -1;
      });

      // remove this filter from the search string
      value = value.replace(label[0], '');
    }

    // handle platform filter
    const platform = value.match(/platform:"([^"]+)"/i);
    if (platform) {
      base = base.filter(
        pkg => {
          if (!pkg.platforms) {
            return true;
          }
          return pkg.platforms.toLowerCase().split(',').indexOf(platform[1].toLowerCase()) > -1
        }
      );

      // remove this filter from the search string
      value = value.replace(platform[0], '');
    }

    if (!value.trim()) {
      // if after that filtering no search terms remain, just return what's left
      return base;
    }

    // use minisearch to find matches with some level of fuzziness
    // we sloppily reset the index each search
    // which is wasteful of cpu cycles I guess, but it seems fast enough :shrug:
    // https://github.com/lucaong/minisearch
    const minisrch = new minisearch({
      idField: 'name',
      fields: ['name', 'description'],
      searchOptions: {
          boost: { name: 2 },
          fuzzy: 0.2,
          prefix: true
        }
    });

    // start with all data post label/author filtering
    minisrch.addAll(base);
    // search and then map results so we can easily use them for output
    const miniresult = minisrch.search(value.trim())
    const minikeys = miniresult.map(mini => mini.id);
    const scores = miniresult.reduce((acc, mini) => {
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
}
