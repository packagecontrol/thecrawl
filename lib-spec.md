# repository.json spec

This document describes the user-facing `repository.json` format used to define
libraries and their release sources.

## Top-level structure

`repository.json` is a JSON object with these fields:

```json
{
  "$schema": "sublime://packagecontrol.io/schemas/repository",
  "schema_version": "4.0.0",
  "packages": [],
  "libraries": [ ... ]
}
```

Only `libraries` is relevant for this crawler.

## Library metadata

Each library entry contains metadata and a list of release definitions:

```json
{
  "name": "lxml",
  "description": "lxml",
  "author": "lxml dev team",
  "issues": "https://bugs.launchpad.net/lxml",
  "releases": [ ... ]
}
```

Fields:
- `name` (string, required): Library identifier used by Package Control.
- `description` (string, optional): Short human-readable description.
- `author` (string, optional): Library author/maintainer.
- `issues` (string, optional): Issue tracker URL.
- `releases` (list, required): One or more release definitions (see below).

If `description`, `author`, or `issues` are missing, they are resolved from
Pypi or GitHub metadata, whereby Pypi is preferred.

## Release definitions

Each release definition describes how to fetch a compatible artifact. Release
definitions are used for both PyPI and GitHub sources; the `base` URL decides
which backend is used and is the only required field.

### Minimal definition (PyPi)

```json
{
  "base": "pypi:pydantic-core"
}
```

Declaring just the base finds artifacts for all supported platforms and
python versions.

The supported platforms are:

- `windows-x64`, `windows-x32`
- `osx-x64`, `osx-arm64`
- `linux-x64`, `linux-arm64`

The supported python versions (Sublime Text hosts) are:

- `3.3`, `3.8`, `3.13`

T.i. we try to find up to 18 artifacts (6 platforms x 3 Python versions),
falling back to `py3-none-any` or `py2.py3-none-any` wheels when available.


### A (kind of) maximal definition

```json
{
  "base": "https://pypi.org/project/watchdog",
  "asset": "watchdog-*-py3-none-win32.whl",
  "platforms": "windows-x32",
  "python_versions": "3.13"
}
```

This is a single-platform, single-Python release that relies on one explicit
asset pattern. If no matching wheel exists, the release fails.


###  Two more fields

`sublime_text` is usually `*` or omitted (applies to all ST builds), but you can
restrict it to a build like `"4147"` or split by range, e.g.
`"3154 - 4069"` and `">=4070"` as in `lsp_utils`.  If you use a list here,
one artifact per build is prepared.

`version` is usually `*` or omitted, t.i. we take the newest version that
matches the asset pattern. You can restrict it using simple patterns, e.g. `5.*`
or `4.1.*`, or full PEP 440 specifiers, e.g. `==3.2.2`, or `>=4.2.2,<5`.


### Specifying a list of values acts as "multiplier" and fetches multiple artifacts

E.g.

```json
{
  "base": "pypi:watchdog",
  "asset": "watchdog-*-py3-none-win32.whl",
  "platforms": "windows-x32",
  "python_versions": ["3.8", "3.13"]
}
```
is resolved to

```json
[
  {
    "base": "pypi:watchdog",
    "asset": "watchdog-*-py3-none-win32.whl",
    "platforms": "windows-x32",
    "python_versions": "3.8"
  },
  {
    "base": "pypi:watchdog",
    "asset": "watchdog-*-py3-none-win32.whl",
    "platforms": "windows-x32",
    "python_versions": "3.13"
  }
]
```

So one definition can expand into many; adding a platform list creates a
matrix of platform x Python version combinations.
The same applies to `sublime_text`: a list of build selectors expands into
multiple release variants.


### The important "asset" field

`asset` is a glob-style pattern matched against wheel filenames (PyPI) or
GitHub release asset names. It may be a single string or an ordered list of
patterns (first match wins).

If set to a list it does not act as a multiplier; it is a fallback list and we
try the patterns in order.


E.g. a static wildcard pattern:

```
"asset": "watchdog-*-py3-none-win32.whl",
```

A pattern with variable placeholders in it

```
"asset": "tree_sitter-*-cp${py_version}-cp${py_version}-manylinux_*_aarch64.whl",
```

Variables are substituted once per value in the matching constraint list. If
the variable is not present in a pattern, the pattern is left unchanged.
Values come from the corresponding constraints; `*` expands to the supported
list for that field.


Supported variables in asset patterns:
- `${version}`: Release version (e.g., `3.10.15`).
- `${py_version}`: Python version with dots removed (e.g., `3.13` -> `313`).
- `${platform}`: Platform identifier (e.g., `windows-x64`).
- `${st_build}`: Sublime build (normalized; see `sublime_text` above).

Glob rules:
- `*` matches any sequence of characters.
- `?` matches a single character.


### Summary

Common fields:
- `base` (string, required): Source Provider or URL.
  - PyPi: `pypi:<name>` or the long format `https://pypi.org/project/<name>`
    Pinned version, e.g. `https://pypi.org/project/<name>/<version>`, is deprecated;
    just use the "version" field.
  - GitHub: `github:<owner>/<repo>` or the long form
    `https://github.com/<owner>/<repo>`.

- `platforms` (string or list, optional): Sublime platform identifiers.
   default: all supported platforms (`*`).

- `python_versions` (string or list, optional): Supported Python versions.
   default: all supported Python versions (`*`).

- `sublime_text` (string or list, optional): Sublime build selector(s).
   default: `*` (any build).

- `version` (string, optional): PEP 440 version specifier for filtering releases.
   default: `*` (no version filter).

- `asset` (string or list, optional): Asset glob(s) to match.
   default: generated for Pypi; required for GitHub unless `tags` is provided.


- `tags` (bool or string, GitHub-only): Use tags and optionally a prefix filter.


Supported `platforms` values:
- `windows-x64`, `windows-x32`
- `osx-x64`, `osx-arm64`
- `linux-x64`, `linux-arm64`

Supported `python_versions` values:
- `3.3`, `3.8`, `3.13`

Supported `sublime_text` selectors (string or list):
- `"*"` (any build)
- `"4147"` (exact build)
- `">4147"`
- `">=4147"`
- `"<4147"`
- `"<=4147"`
- `"3154 - 4069"` (inclusive range)
- `"4147 - 4200"` (inclusive range)

Supported `version` values:

- `*` or omitted (no filter).
- Simple forms like `5.*` or `4.1.*`, or PEP 440 specifiers such as `==3.2.2`, `>=4.2.2,<5`.


### More Examples

#### Automated short release definition (PyPI, no asset)

When `asset` is omitted for a PyPI release, the crawler builds patterns
automatically from the platform and Python version(s):

```json
{
  "base": "pypi:lxml",
  "platforms": "osx-x64",
  "python_versions": "3.13"
}
```

This expands to a prioritized pattern list like:
- `*-${version}-cp313-cp313m-macosx_*_x86_64.whl`
- `*-${version}-cp313-cp313-macosx_*_x86_64.whl`
- `*-${version}-py3-none-any.whl`
- `*-${version}-py2.py3-none-any.whl`

Example filenames for `lxml` that would match:
- `lxml-6.0.2-cp313-cp313-macosx_10_13_x86_64.whl`
- `lxml-6.0.2-cp313-cp313-macosx_10_13_universal2.whl`

#### In-between release definition (constraints as strings, asset uses vars)

Here the constraints are plain strings (not lists) and the asset still uses
variables:

```json
{
  "base": "pypi:pydantic-core",
  "platforms": "linux-x64",
  "python_versions": "3.13",
  "asset": "pydantic_core-*-cp${py_version}-cp${py_version}-manylinux_*_x86_64.whl"
}
```

`python_versions: "3.13"` is normalized to `["3.13"]` internally, and
`${py_version}` becomes `313` in the pattern.

#### Fully manual release definition (explicit asset)

**that is not manual**  it expands for python_versions and asset is a wildcard
pattern!  Static is e.g. "4.2.1-cp37-abi3-win_amd64"

Putting the version into asset is not recommend however.  Use "version" for it.

Fully manual definitions specify explicit assets without variables:

```json
{
  "base": "pypi:pycryptodome",
  "platforms": ["windows-x64"],
  "python_versions": ["3.8", "3.13"],
  "asset": "pycryptodome-*-cp37-abi3-win_amd64"
}
```

This uses a fixed ABI tag (`abi3`) and explicit platform tag (`win_amd64`).

##### Optional version pinning and filters

Use a `version` specifier (PEP 440), e.g.:

```json
{
  "base": "pypi:Markdown",
  "python_versions": ["3.13"],
  "asset": "markdown-*-py3-none-any.whl",
  "version": ">=3.4,<4"
}
```

Bare versions and prefixes are normalized to `==`:
- `"3.2.2"` -> `"==3.2.2"`
- `"5.*"` -> `"==5.*"`

Deprecated: Pin in the `base` URL (from `repository.json`):

```json
{
  "base": "https://pypi.org/project/Markdown/3.2.2",
  "asset": "Markdown-*-py3-none-any.whl",
  "python_versions": ["3.8"]
}
```

### GitHub release definitions

GitHub releases can use tags and/or release assets:

- `tags: true` (the default) means "latest tag".
- `tags: "st3-v"` means "latest tag with this prefix".
- `asset` (if present) selects a GitHub release asset by pattern.

Examples:

Grab latest tag:
```json
{
  "base": "github:sublimelsp/lsp_utils",
  "sublime_text": ">=4070",
}
```

Tag prefix split by Sublime build (from `lsp_utils`):
```json
{
  "base": "github:sublimelsp/lsp_utils",
  "python_versions": ["3.3", "3.8", "3.13"],
  "sublime_text": "3154 - 4069",
  "tags": "st3-v"
}
```

Release assets (from `sublime_aio`):
```json
{
  "base": "github:packagecontrol/sublime_aio",
  "python_versions": ["3.8", "3.13"],
  "asset": "sublime_aio-*-py3-none-any.whl"
}
```

Tags + assets (from `sublime_lib`):
```json
{
  "base": "github:SublimeText/sublime_lib",
  "python_versions": ["3.3"],
  "tags": "st3-v",
  "asset": "sublime_lib-*-py3-none-any.whl"
}
```

## Real-world wheel name examples

From `.pypi-cache/orjson.json`:
- `orjson-3.10.15-cp38-cp38-macosx_10_15_x86_64.macosx_11_0_arm64.macosx_10_15_universal2.whl`
- `orjson-3.10.15-cp38-cp38-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`

From `.pypi-cache/lxml.json`:
- `lxml-6.0.2-cp313-cp313-macosx_10_13_x86_64.whl`
- `lxml-6.0.2-cp313-cp313-macosx_10_13_universal2.whl`
