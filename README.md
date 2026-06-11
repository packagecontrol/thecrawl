# thecrawl

[![CI](https://github.com/packagecontrol/thecrawl/actions/workflows/ci.yml/badge.svg)](https://github.com/packagecontrol/thecrawl/actions/workflows/ci.yml)
[![Crawler](https://github.com/packagecontrol/thecrawl/actions/workflows/crawl.yml/badge.svg)](https://github.com/packagecontrol/thecrawl/releases)

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
dot notation.  A typical rundown up to a channel.json ready for consumption by Sublime Text
is:

```bash
$ uv run -m scripts.generate_registry
$ uv run -m scripts.crawl
$ uv run -m scripts.crawl_libraries
$ uv run -m scripts.generate_channel
```

Note however, that packages and libraries are currently on different registries. To tell
`generate_registry` invoke it rather like

```bash
$ uv run -m scripts.generate_registry \
  --channel https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json \
  --channel https://raw.githubusercontent.com/sublimehq/package_control_channel/refs/heads/master/channel.json
```

For `crawl`, a GITHUB_TOKEN environment variable is *required*.  GitLab and Bitbucket
can be used in a free mode -- basically because we don't have many users on these
platforms, so that even the tiny rate limits are enough for our purpose.

---

## Core Scripts

### 1. `generate_registry.py`

Fetches and generates a registry of all packages and dependencies from one or more package
control channels.  Defaults to our main channel, collected and maintained at
[sublimehq](https://github.com/sublimehq/package_control_channel).

Supports also Package Control repositories as input, e.g. the highly trusted
https://github.com/sublimehq/package_control_channel/blob/master/repository.json


```bash
uv run -m scripts.generate_registry
uv run -m scripts.generate_registry --output myreg.json --channel <url1> --channel <url2>
```

`generate_registry` supports implicit lifecycle enrichment. I.e. newly discovered
packages get a `first_seen` timestamp, packages that are removed from the input
channels/repositories are re-added in a tombstoned way.  Also input channels/repositories
that throw on access will lead to marked entries *if* a previous registry/seed is
present; this way we prevent packages from jumping between different sources, esp.
malicious ones.

This behavior is on by default, however you might not notice it as we don't blindly
add "first_seen: now" stamps when there is in fact no prior registry found.

Concretely,

- default seed path is `--output`; this way running generate_registry multiple times
  from the same directory, will use the file we wrote on the last run as seed-input.

- `--seed [PATH]` enforces seed input (supports `registry.json`, `workspace.json`,
  and `seed.json`-style package maps).  Will raise if the seed is not present/readable.

- `--no-seed` disables lifecycle enrichment (`first_seen`/`removed` tombstones);
  however, source-failure marking still applies when prior seed data is available.

```bash
uv run -m scripts.generate_registry --output registry.json
uv run -m scripts.generate_registry --output registry.json --seed ./the-registry/registry.json
uv run -m scripts.generate_registry --output registry.json --no-seed
```

To create a compact archival seed, use `generate_seed` with either a workspace
or a registry as input (but not both):

```bash
uv run -m scripts.generate_seed --workspace ./workspace.json --output ./seed.json
uv run -m scripts.generate_seed --registry ./registry.json --output ./seed.json
```

---

### 2. `crawl.py`

The meat.
Crawls the package registry to update per-package release and metadata information, and
stores it in a workspace file (`workspace.json`).
Supports crawling all packages, or a single package via the `--name` option.

Use `--presto` (or set `PRESTO_PRESTO_CRAWL=1`) to bypass `next_crawl` scheduling
and fast-forward the workspace by crawling up to `--limit` packages.

Use `--explain` to show a side-by-side view of the registry entry and the
normalized package entry. This is useful for looking under the hood and seeing
which values the crawler fills in to turn a sparse definition into a full one.
Set `EFFECTIVE=1` to switch `--explain` to machine-friendly plain text for the
effective "newest" release definition.

- Integrates with GitHub, GitLab, and Bitbucket APIs to fetch detailed info and releases.
- Requires a valid `GITHUB_TOKEN` in your environment for GitHub API access because GitHub's GraphQl
  cannot be used in a free-mode.
- Handles rate limits and retry/backoff logic for failing packages.
- Maintains per-package crawl state, timestamps, and reasons for failures.


```bash
$ GITHUB_TOKEN=ghp_yourgithubtokenhere uv run -m scripts.crawl
$ uv run -m scripts.crawl --name GitSavvy
$ uv run -m scripts.crawl --explain GitSavvy
$ EFFECTIVE=1 uv run -m scripts.crawl --explain GitSavvy
```

---

### 3. `generate_channel.py`

Writes the valid packages and libraries into a final `channel.json` suitable for use in
Sublime Text Package Control.

- Reads the registry and workspace, validates/collates package and library entries.
- Drops entries with no valid releases or required fields.
- Outputs a `channel.json` with valid items grouped by repository into `packages_cache`
  and `libraries_cache`.

```bash
$ uv run -m scripts.generate_channel
```

The output is a fat `channel.json`.
Use `--berlin` to format relative "since" timestamps in Europe/Berlin instead of UTC.

---

### 4. `compress_channel.py`

Reads the channel from step 3 and produces a compressed output suitable for either
[st4](https://github.com/packagecontrol/thecrawl/releases/tag/the-channel) or
[st3](https://github.com/packagecontrol/thecrawl/releases/tag/the-st3-channel).

```bash
$ uv run -m scripts.compress_channel
$ uv run -m scripts.compress_channel --pretty
$ uv run -m scripts.compress_channel --legacy
```

Use `--pretty` at home and `--legacy` to emit a Sublime Text 3 channel.

---

### 5. `crawl_libraries.py`

Resolves library release info from a `registry.json` and writes a workspace
JSON (default: `workspace.json`).

Generate a registry from the standard libraries repository, then crawl it. Use
`--registry/-r` if the registry has a different name, or `--workspace/-o` to
write the output elsewhere.

```bash
$ uv run -m scripts.generate_registry --channel https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json
$ uv run -m scripts.crawl_libraries
```

#### Inspecting entries

Library entries can be tricky on both sides: release definitions in the
registry, and resolved release JSON in the workspace.

Use `--name` to crawl a single library and print the resolved releases as a
matrix. Use `--explain` to print each release definition side-by-side with the
concretized variations the crawler will use, including inferred defaults.

These modes are dry by default. For `--name`, add `--write` to write the
resolved entry to the workspace. Add `--json` to print pretty JSON.

```bash
$ uv run -m scripts.crawl_libraries --name lxml
$ uv run -m scripts.crawl_libraries --name lxml --json
$ uv run -m scripts.crawl_libraries --explain lxml
$ uv run -m scripts.crawl_libraries --explain lxml --json
```

#### Trying release definitions

Add `--try` with `--name` or `--explain` to test release definitions without
editing `registry.json`. If the library exists in the registry, its metadata is
reused and only the `releases` section is replaced in memory.

`--try` accepts JSON or a small YAML-ish `key: value` shorthand. Inline
shorthand definitions may use `;` separators for quick checks. If the name is
omitted, the crawler tries to infer it.

```bash
$ uv run -m scripts.crawl_libraries --try "base: pypi:lxml"
$ uv run -m scripts.crawl_libraries --try "base: pypi:lxml" --explain
$ uv run -m scripts.crawl_libraries --try "base: pypi:pyobjc-framework-Cocoa; platform: osx; python: 3.8"
```

Inline shorthand also accepts a few convenience aliases: `platform` for
`platforms`, `python` for `python_versions`, and broad platform values
`windows`, `osx`, or `linux` for their supported architecture variants.

For multiline or more complex definitions, omit the value or pass `-` to read
from stdin. Stdin definitions use normal newlines, not `;` separators.

```bash
$ uv run -m scripts.crawl_libraries --name lxml --try <<'DEF'
base: pypi:lxml
platforms: windows-x32
DEF
```

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

---

### Logs handling

#### `collect_logs.py`

`scripts/collect_logs.py` appends the current run's `notes.txt` to `logs.json` (rolling history),
keyed by run id and trimmed to a retention window (`--history-days`, default 32).

If you pass a `--workspace` it include a `found_updates` list for packages detected in that run.

```bash
uv run -m scripts.collect_logs --output ./logs.json --workspace ./workspace.json ./notes.txt
```

This is a very mechanical step done in the crawl.yml; after the job is done we enrich the logs
in publish.yml:

#### `refresh_logs.py` (plus lower-level helpers)

Use this when you want to reproduce/update `logs.json` locally with GitHub Actions metadata.
`gh` is required for the ad-hoc queries I make herein.

```bash
# one-shot: download logs (if missing), fetch metadata, enrich logs
uv run -m scripts.refresh_logs --pretty
```

Defaults are tuned for local use:
- repo: inferred from `GITHUB_REPOSITORY` or local `git origin`
- workflow id: inferred from `crawl.yml` if not set
- since window: `--since-hours 24`
- metadata files: `./workflow_runs.json`, `./workflow_artifacts.json`
- artifact scan cap: `--artifacts-max-pages 10`
- logs path: `./logs.json`

If you want explicit control, run the two low-level commands, that's what we do in publish.yml:

```bash
uv run -m scripts.fetch_logs_metadata --pretty
uv run -m scripts.enrich_logs --pretty
```

---

### `snapshot_test.py`

Creates a compact, single-file snapshot for regression testing (`registry + channel`) from a reduced package set.

```bash
uv run -m scripts.snapshot_test
uv run -m scripts.snapshot_test --base snapshot.yml --conf snapshot.toml
uv run -m scripts.snapshot_test shoot
uv run -m scripts.snapshot_test diff
uv run -m scripts.snapshot_test diff snapshot-2026-03-02-1210-abcd123.yml
```

- Default mode (no subcommand):
  - if base exists, writes a new `snapshot-<timestamp>-<hash>.yml` and prints a line-based diff vs base
  - if base does not exist, writes/creates the base snapshot, using `shoot`.
- `shoot` explicitly creates/overwrites a target snapshot (default: `snapshot.yml`).
- Noise is sent to a temporary folder (`tmp--<timestamp>-<hash>`), which is removed on success.

## Tests

We use `pytest`. Execute everything via uv so dependencies come from `pyproject.toml`/`uv.lock`:

```bash
uv run pytest
```

Helpful variations:

- `uv run --with pytest-xdist pytest -f` keeps a continuous loop (`-f/--looponfail`) that reruns on each change.
- And [PyTest](https://packages.sublimetext.io/packages/PyTest/) of course, 😏.


## Something wrong with `the-registry`?

Check it out

```
git worktree add .the-registry the-registry
; hack on it
git -C .the-registry push -u origin the-registry
```
