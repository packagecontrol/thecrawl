# repository.json spec

This document describes the user-facing `repository.json` format used to define
packages and their release sources.

It intentionally documents what this crawler supports today.
`example-repository.json` from Package Control is good inspiration, but broader.

## Top-level structure

`repository.json` is a JSON object with these fields:

```json
{
  "$schema": "sublime://packagecontrol.io/schemas/repository",
  "schema_version": "4.0.0",
  "packages": [ ... ],
  "libraries": []
}
```

Only `packages` is relevant for this document.

## Package metadata

Each package entry contains metadata and a list of release definitions:

```json
{
  "name": "GitSavvy",
  "details": "https://github.com/timbrel/GitSavvy",
  "labels": ["vcs"],
  "releases": [ ... ]
}
```

Common fields:
- `name` (string, usually required): Package name shown in Package Control.
  If omitted, name is derived from `details` where possible.
- `details` (string, optional but common): Repository URL used to fetch metadata.
- `description`, `author`, `homepage`, `readme`, `issues`, `donate`, `buy`
  (optional): Explicit metadata overrides.
- `labels` (list, optional): Search/category labels.
- `previous_names` (list, optional): Old package names for rename migration.
- `releases` (list, optional): One or more release definitions.

If `releases` is missing, a synthetic default release is created:

```json
{
  "sublime_text": "*",
  "tags": true
}
```

A minimal definition the crawler understands is:

```json
{
  "details": "https://github.com/timbrel/GitSavvy",
}
```

However, adding a name really helps in readability.

Tip: Use `$ uv run -m scripts.crawl --explain GitSavvy` to show the
     normalized/expanded package definition.

## Release definitions

For packages, there are three dynamic release modes:

1. `tags` (normal/default)
2. `branch`
3. `asset`

There is also static/manual form (`url` + `version` + `date`) which is treated
as already fulfilled and passed through.

---

### 1) Tags mode (default)

Minimal explicit tags release:

```json
{
  "sublime_text": "*",
  "tags": true
}
```

If a release has none of `url`, `asset`, `branch`, `tags`, we autofill
`"tags": true`.

`tags` values:
- `true`: all tags are considered, a possible prefix "v" is stripped automatically
- string prefix: only tags starting with that prefix are considered

Examples:

```json
{ "sublime_text": "<4000", "tags": "st3-" }
```

```json
{ "sublime_text": ">=4000", "tags": true }
```

#### Tag parsing behavior

Without a `version` constraint, tags use strict semver parsing
(`major.minor.patch`, optional `-prerelease`, optional `+build`).

With a `version` constraint, parsing uses PEP 440 (`packaging.Version`), which
allows versions like `1.0rc1`.  See below for examples.

Example:

```json
[
  {
    "sublime_text": "<4000",
    "version": "2.5.*"
  }
]
```

#### Rolling window behavior

Tags mode keeps all matching tags from the recent rolling window
(about 53 weeks).
If that window does not contain a final release, we still keep a leading
prerelease when present.

If no valid tag can be resolved, tags mode reports an error and can fall back
to branch mode (see below).

---

### 2) Branch mode

Branch-based release definitions:

```json
{
  "sublime_text": "*",
  "branch": true
}
```

```json
{
  "sublime_text": "*",
  "branch": "dev"
}
```

`branch` values:
- `true`: use repository default branch (`default_branch`, fallback `master`)
- string: use that branch name

Resolved branch releases get their version synthesized from branch date,
e.g. `2024-05-10T12:00:00Z` -> `2024.05.10.12.00.00`.

#### Tags -> branch fallback

If a release definition is tag-based and no valid tag is found,
the crawler tries branch resolution for the same definition.

- If `branch` is set, that branch is used for fallback.
- If `branch` is not set, fallback goes to default branch (`branch: true`).

This fallback is per release definition.

---

### 3) Asset mode

Asset mode resolves downloadable artifacts from hosted release assets
(currently GitHub release assets in practice).

Minimal asset release:

```json
{
  "asset": "A File Icon.sublime-package"
}
```

Commonly with wildcards:

```json
{
  "asset": "*.sublime-package"
}
```

Asset patterns are glob-like strings:
- `*` matches any sequence
- `?` matches a single character

Supported placeholders in package asset patterns:
- `${version}`: resolved tag version
- `${st_build}`: normalized `sublime_text` build marker
- `${platform}`: platform token (`*` becomes `any`)

Example with placeholders:

```json
{
  "asset": "Less-${version}-st${st_build}.sublime-package",
  "sublime_text": ["4107 - 4148", ">=4149"]
}
```

Asset mode resolves a target matrix of `platforms x sublime_text` and picks the
first matching asset per target (newest releases first).
Different targets may resolve to different versions if needed.

If targets remain unresolved, the crawler logs which `(platform, st_build)`
combinations are missing.

> Note: asset mode does **not** fall back to branch mode when assets are missing.

---

### Static/manual releases

A release containing `url`, `version`, and `date` is considered fulfilled:

```json
{
  "sublime_text": "*",
  "platforms": ["*"],
  "version": "1.2.3",
  "url": "https://example.com/my-package.zip",
  "date": "2024-05-10T12:00:00Z"
}
```

Accepted `date` input formats are normalized to UTC form:
- `YYYY-MM-DDTHH:MM:SSZ`
- `YYYY-MM-DD HH:MM:SS`
- `YYYY-MM-DD HH:MM`
- `YYYY-MM-DD`

## Constraints and defaults

Common release fields:
- `sublime_text` (string, optional): default `"*"`.
- `platforms` (string or list, optional): default `["*"]`.
- `base` (string, optional): release source URL; defaults to package `details`.
- `tags` (bool or string, optional): tag mode and optional prefix.
- `branch` (bool or string, optional): branch mode.
- `asset` (string, optional): asset mode pattern.
- `version` (string, optional): version filter for dynamic modes.
- `url`, `date` (string, static mode): explicit resolved release.

`version` normalization:
- `"*"` or empty -> no constraint
- bare versions/prefixes are normalized with `==`
  - `"2.5.*" -> "==2.5.*"`
  - `"1.2.3" -> "==1.2.3"`
- full specifiers are kept, e.g. `">=2,<3"`

Supported `sublime_text` selectors include:
- `"*"`
- exact build (`"4147"`)
- comparisons (`">4147"`, `">=4147"`, `"<4147"`, `"<=4147"`)
- inclusive ranges (`"3154 - 4069"`)

`sublime_text` as a list is only valid for `asset` releases.

Common `platforms` values seen in package definitions:
- `*`, `windows`, `osx`, `linux`
- and architecture-specific forms like
  `windows-x64`, `windows-x32`, `osx-x64`, `osx-arm64`, `linux-x64`, `linux-arm64`

## Automatic open-ended tags release (for constrained tags)

When all release definitions are version-constrained tag releases with bounded
`sublime_text` ranges, the crawler may append a synthetic open-ended tags
release.

Example input:

```json
[
  {
    "sublime_text": "<4000",
    "version": "<3.0.0"
  }
]
```

becomes effectively:

```json
[
  {
    "sublime_text": "<4000",
    "version": "<3.0.0",
    "tags": true
  },
  {
    "sublime_text": ">3999",
    "tags": true
  }
]
```

This avoids leaving newer Sublime builds without a release definition
and effectively keeps the releases section short.
