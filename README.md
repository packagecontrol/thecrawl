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

The downloaded artifacts, generated `_site/` directory, and installed
`node_modules/` are ignored by Git.

## Project structure

- `_includes/` — shared page layout, header, head, and footer
- `index.njk` — landing page
- `status/index.njk` — crawler status page
- `static/status.js` — status data loading and chart rendering
- `static/module/` — status data helpers and tests
- `static/styles.css` — site-wide design and layout
- `static/style/status.css` — status-page and chart styling
