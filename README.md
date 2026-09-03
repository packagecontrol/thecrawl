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

You can also pass a comma-separated list of package names to focus on specific entries:

```bash
LIMIT_DATASET="A File Icon,GitGutter" npm run dev -- --quiet
```

If you quickly want to see old packages:

```bash
LIMIT_DATASET=-100 npm run dev -- --quiet
```

Or run it on `http-server`, e.g.

```bash
npm run devb
```

And again with a smaller dataset:
```bash
LIMIT_DATASET=100 npm run devb
```

### Environment variables

- `LIMIT_DATASET` — limit the number of packages or provide a comma-separated list of package names (case-insensitive) to include.
- `SITE_ORIGIN` — override the generated site's origin, for example `https://packagecontrol.github.io`.
- `SITE_PATH_PREFIX` — host the generated site below a path such as `/website-stage`.
- `DISABLE_L_LINK` — set to any non-empty value to hide the dev-only “L” link to the live site.


[pcr]: https://packages.sublimetext.io
[11ty]: https://www.11ty.dev/docs/
[nunjucks]: https://mozilla.github.io/nunjucks/templating.html
[db]: https://github.com/packagecontrol/thecrawl/releases/download/crawler-status/workspace.json
[thecrawl]: https://github.com/packagecontrol/thecrawl
