# [Package Control R][pcr]

A Sublime Text packages database


## Dependencies

- [11ty][] static site generator
- [nunjucks][] templating engine
- [the crawl][db] database on [the `main` branch][thecrawl].


## Run locally

You have multiple options. After

```bash
npm install
```

download all the data, e.g. using `gh`, the GitHub CLI:

```bash
gh release download "crawler-status" --clobber
```

Now, just run eleventy directly in watch mode, e.g.

```bash
npm run dev -- --quiet
```
Limit the dataset for a faster build

```bash
LIMIT_DATASET=100 npm run dev -- --quiet
```
Or run it on `http-server`, e.g.

```bash
npm run devb
```
And again with a smaller dataset:
```bash
LIMIT_DATASET=100 npm run devb
```


[pcr]: https://packages.sublimetext.io
[11ty]: https://www.11ty.dev/docs/
[nunjucks]: https://mozilla.github.io/nunjucks/templating.html
[db]: https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json
[thecrawl]: https://github.com/packagecontrol/thecrawl
