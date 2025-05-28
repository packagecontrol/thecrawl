# pc-e02-thecrawl

_“The Crawl”_ is a fully transparent crawler for the Sublime Text package ecosystem.
It fetches and verifies package metadata from registered channels, builds a reproducible
registry, and generates a `channel.json` suitable for Package Control.

## Design goal

This project is built for an open world, not just “public source.”
The crawler is designed to run in the public, but every script can run on your
local machine with little effort.  Every failing state should be reproducible
locally, without staring at logs.

The crawler runs a GitHub [action](https://github.com/kaste/pc-e02-thecrawl/blob/main/.github/workflows/crawl.yml) and produces release artifacts and notes.
https://github.com/kaste/pc-e02-thecrawl/releases
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
$ uv run -m scripts.collate_channel
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

### 3. `collate_channel.py`

Collates the workspace and registry into a final `channel.json` suitable for use in Sublime Text Package Control.

- Reads the registry and workspace, validates/collates package entries.
- Drops packages with no valid releases or required fields.
- Outputs a `channel.json` with all valid packages grouped by repository.
- By default, skips old/outdated packages for smaller download size.

**Example:**
```bash
$ uv run -m scripts.collate_channel
```
