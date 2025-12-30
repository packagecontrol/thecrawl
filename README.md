# thecrawl

_“The Crawl”_ is a fully transparent crawler for the Sublime Text package ecosystem.
It fetches and verifies package metadata from registered channels, builds a reproducible
registry, and generates a `channel.json` suitable for Package Control.

## Design goal

This project is built for an open world, not just “public source.”
The crawler is designed to run in the public, but every script can run on your
local machine with little effort.  Every failing state should be reproducible
locally, without staring at logs.

The crawler runs a GitHub [action](https://github.com/packagecontrol/thecrawl/blob/main/.github/workflows/crawl.yml) and produces release artifacts and notes.
https://github.com/packagecontrol/thecrawl/releases
Its logs are open by its very nature.

## Usage locally

For ease of use, you should (really, do it!) use [uv](https://docs.astral.sh/uv/) as it
handles all the python shenanigans related to virtual environments, dependencies, and
python versions.

It is assumed that your working dir is the root of the project.  Invoke all scripts using
dot notation.

```bash
$ uv run -m scripts.generate_registry
$ uv run -m scripts.crawl
$ uv run -m scripts.generate_channel
```

For `crawl`, a GITHUB_TOKEN environment variable is *required*.  GitLab and Bitbucket
can be used in a free mode -- basically because we don't have many users on these
platforms, so that even the tiny rate limits are enough for our purpose.

---

## Core Scripts

### 1. `generate_registry.py`

Fetches and generates a registry of all packages and dependencies from one or more package
control channels.  Defaults to our main channel, collected and maintained at
[wbond](https://github.com/wbond/package_control_channel).

Supports also Package Control repositories as input, e.g. the highly trusted
https://github.com/wbond/package_control_channel/blob/master/repository.json


```bash
uv run -m scripts.generate_registry
uv run -m scripts.generate_registry --output myreg.json --channel <url1> --channel <url2>
```

---

### 2. `crawl.py`

The meat.
Crawls the package registry to update per-package release and metadata information, and
stores it in a workspace file (`workspace.json`).
Supports crawling all packages, or a single package via the `--name` option.
Use `--presto` (or set `PRESTO_PRESTO_CRAWL=1`) to bypass `next_crawl` scheduling
and fast-forward the workspace by crawling up to `--limit` packages.

- Integrates with GitHub, GitLab, and Bitbucket APIs to fetch detailed info and releases.
- Requires a valid `GITHUB_TOKEN` in your environment for GitHub API access because GitHub's GraphQl
  cannot be used in a free-mode.
- Handles rate limits and retry/backoff logic for failing packages.
- Maintains per-package crawl state, timestamps, and reasons for failures.


```bash
$ GITHUB_TOKEN=ghp_yourgithubtokenhere uv run -m scripts.crawl
$ uv run -m scripts.crawl --name GitSavvy
```

---

### 3. `generate_channel.py`

Writes the valid packages into a final `channel.json` suitable for use in Sublime Text Package Control.

- Reads the registry and workspace, validates/collates package entries.
- Drops packages with no valid releases or required fields.
- Outputs a `channel.json` with all valid packages grouped by repository.

```bash
$ uv run -m scripts.generate_channel
```

The output is a fat `channel.json`.
Use `--berlin` to format relative "since" timestamps in Europe/Berlin instead of UTC.

---

### 4. `collate_channel.py`

Reads the channel from step 3, and collates libraries from https://github.com/packagecontrol/channel. 
Finally produces compressed output for either 
[st4](https://github.com/packagecontrol/thecrawl/releases/tag/the-channel) or 
[st3](https://github.com/packagecontrol/thecrawl/releases/tag/the-st3-channel) only.   

---

### `accumulate_stats.py`

`scripts/accumulate_stats.py` turns the raw install totals from https://stats.sublimetext.io into rolling daily, weekly, and yearly deltas that we publish alongside the crawler output.

```bash
uv run -m scripts.accumulate_stats --wd ./wrk
```

The command above reuses the same layout as [CI](https://github.com/packagecontrol/thecrawl/blob/main/.github/workflows/crawl.yml) (`wrk/stats.json`, `wrk/prev_totals.json`). Use `--pretty` for readable JSON or `--url` to point at a different totals endpoint.

- Successful runs upload `wrk/stats.json` to the `crawler-status` release and keep a 30-day `stats-backup` artifact with the full working directory.

#### Restoring stats from a backup

- Download a `stats-backup` artifact from the workflow run (or copy a saved local `wrk/` snapshot) and extract it into `restore-stats/` at the repo root.
- On the next execution, the script detects files in `restore-stats/`, hashes their contents, and copies them into the working directory exactly once (it drops a marker named `ingested_<hash>` to avoid double imports).
- You can choose another directory via `--restore-from <path>` if you want to stage the backup elsewhere.
- Try this locally first, then commit and push to actually replace/update/restore the GitHub action cache

## Tests

We use `pytest`. Execute everything via uv so dependencies come from `pyproject.toml`/`uv.lock`:

```bash
uv run pytest
```

Helpful variations:

- `uv run --with pytest-xdist pytest -f` keeps a continuous loop (`-f/--looponfail`) that reruns on each change.
- And [PyTest](https://packages.sublimetext.io/packages/PyTest/) of course, 😏.
