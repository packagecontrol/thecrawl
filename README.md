# thecrawl site

The landing and crawler-status site for
[`packagecontrol/thecrawl`](https://github.com/packagecontrol/thecrawl).
It is built with [Eleventy](https://www.11ty.dev/) and contains two pages:

- `/` — the landing page
- `/status/` — recent crawler runs and their notes

## Run locally

Use Node.js 22 or newer. Development also requires
[GNU Make](https://www.gnu.org/software/make/) and the
[GitHub CLI](https://cli.github.com/).

```sh
make dev
```

This installs the Node.js dependencies, downloads the current crawler
artifacts, and starts Eleventy. Eleventy prints the local URL, normally
<http://localhost:8080/>. Changes to page templates, styles, and scripts are
rebuilt automatically while the dev server is running.

The status page reads the downloaded `logs.json`. It falls back to
<https://repackager.sublimetext.io/logs.json> if the local file is unavailable.

## Build and test

Create a production-ready static build in `_site/`:

```sh
make build
```

Run the focused status-chart tests:

```sh
make test
```

Refresh `registry.json`, `channel.json`, and `logs.json` without starting a
build or development server:

```sh
make artifacts
```

Build an experimental package-to-crawl history from the retained
`crawl-backup` artifacts:

```sh
make history
```

This step also runs automatically before `make build` and `make dev`. The
collector range-downloads only `workspace.json` from each backup and writes
each completed run atomically to `.crawl-history-cache/`. Later attempts resume
from those records, including after interruption or an API-limit response.
Persist that directory between CI attempts to retain this progress. Collection
uses eight concurrent downloads by default; lower it with
`COLLECT_HISTORY_CONCURRENCY` if a constrained runner encounters memory pressure.
Later runs download only new backups,
retain cached data after artifacts expire, and prune runs that have left
`logs.json`. The generated `crawl-history.json`, downloaded
artifacts, `_site/` directory, and installed `node_modules/` are ignored by
Git.

## Project structure

- `_includes/` — shared page layout, header, head, and footer
- `index.njk` — landing page
- `status/index.njk` — crawler status page
- `static/status.js` — status data loading and chart rendering
- `static/module/` — status data helpers and tests
- `scripts/collect-crawl-history.mjs` — experimental crawl-history collector
- `static/styles.css` — site-wide design and layout
- `static/style/status.css` — status-page and chart styling
