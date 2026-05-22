
What's been cooking
===================


0.15.0
======


* Library definitions are easier to read, match, and debug

Library entries can be tricky on both sides: release definitions in the
registry, and resolved release JSON in the workspace.  So I added tooling
around that.

`crawl_libraries.py --name` still crawls one library in dry-run mode but prints a
platform/Python matrix now instead of raw JSON.  Like so:

```bash
$ uv run -m scripts.crawl_libraries --name numpy
numpy release matrix; -v to see the raw JSON output
Source: pypi:cache
Latest version: 2.4.6

                py33  py38  py313  py314
-------------+--------------------------
windows-x64     X     A     B      B
osx-x64         A'    A     B      B
osx-arm64       -     A     B      B
linux-x64       A''   A     B      B
linux-arm64     -     A     B      B

A   = 1.24.4
A'  = 1.11.0
A'' = 1.10.4
B   = 2.4.6
X   = no version found, run -v for details
```

For the definition side of the problem, `--try` can be used to try out release definitions
without writing a `registry.json`.  It accepts JSON, a small `key: value` shorthand,
or stdin. It can be combined with either `--name` or `--explain`.  E.g.

Use `--name` to see which version the crawler selects for a given definition.

```bash
$ uv run -m scripts.crawl_libraries --name numpy --try <<'DEF'
base: pypi:numpy
platforms: linux-x64
python_versions: 3.14
DEF
numpy release matrix; -v to see the raw JSON output
Source: pypi:cache
Latest version: 2.4.6

              py314
-----------+-------
linux-x64     A

A = 2.4.6
```

`--explain` then shows how that shorthand expands into the normalized
release definitions the crawler actually matches against.

```bash
$ uv run -m scripts.crawl_libraries --explain numpy --try <<'DEF'
base: pypi:numpy
platforms: linux-x64
python_versions: 3.14
DEF
{
  "author": "Numpy",
  "description": "NumPy is the fundamental package for scientific computing with Python.",
  "issues": "https://github.com/numpy/numpy/issues",
  "name": "numpy",
  "schema_version": "4.0.0",
  "source": "https://raw.githubusercontent.com/packagecontrol/channel/refs/heads/main/repository.json"
}

#   Input definition                 Normalized variation
───────────────────────────────────────────────────────────────────────────────────────────
1   {                                {
      "base": "pypi:numpy",            "asset": [
      "platforms": "linux-x64",          "*-${version}-cp314-cp314m-manylinux*_x86_64.whl",
      "python_versions": "3.14"          "*-${version}-cp314-cp314-manylinux*_x86_64.whl",
    }                                    "*-${version}-py3-none-manylinux*_x86_64.whl",
                                         "*-${version}-py2.py3-none-manylinux*_x86_64.whl",
                                         "*-${version}-py3-none-any.whl",
                                         "*-${version}-py2.py3-none-any.whl"
                                       ],
                                       "base": "https://pypi.org/project/numpy",
                                       "platform": "linux-x64",
                                       "python_version": "3.14",
                                       "sublime_text": "*",
                                       "tag_prefix": "v?",
                                       "version": "*"
                                     }
```

---

0.14.0
======


* Added a persistent registry with lifecycle management

0.14.0 stopped treating `registry.json` as a disposable intermediate file.  The
crawl workflow now checks out the dedicated
[`the-registry`](https://github.com/packagecontrol/thecrawl/commits/the-registry)
branch, uses that `registry.json` as the seed for the next run, and commits the
updated registry back to the branch.

That gives the registry a public history and lets the generator track package
lifecycle state instead of only reporting the current channel snapshot.

Previously, lifecycle state was tracked only in the `workspace.json` and before that
hidden in the arcane packagecontrol.io state-machinery.  But we needed persistent
lifecycle to protect package names from takeovers.

That means newly discovered packages can get `first_seen` timestamps, removed
packages stay in the registry as tombstones with `removed` timestamps, and old
names remain reserved instead of becoming invisible.

As far as possible, the old state was extracted (well ... "web-crawled") from
packagecontrol.io and seeded into our registry.

For local runs, `generate_registry` gained seed controls so the same lifecycle
behavior can be reproduced outside CI:

```bash
$ uv run -m scripts.generate_registry --output registry.json \
    --seed ./.the-registry/registry.json
$ uv run -m scripts.generate_registry --output registry.json --no-seed
$ uv run -m scripts.generate_seed --registry registry.json --output seed.json
```

---

0.11.0
======


* thecrawl assumes more defaults

Since "all builds/newest tag" is our gold standard, we just assume it when
nothing contradicts it.

E.g. the minimal definition

```json
    {
      "name": "Accessibility",
      "details": "https://github.com/Yago/ST3-Accessibility"
    }
```

is enough and we will synthesize a standard release definition for it:

```
      "releases": [
        {
          "sublime_text": "*",
          "tags": true
        }
      ]
```

If you need a sublime_text constraint, you can still omit "tags: true", as
that's now the default operation mode.  E.g. the following is now allowed:

```json
    {
      "name": "AceJump",
      "details": "https://github.com/ice9js/ace-jump-sublime",
      "releases": [
        {
          "sublime_text": ">=3000",
        }
      ]
    }
```

The absolute minimum definition is hence:

```json
    {
      "details": "https://github.com/budlime/PathBox"
    }
```
as we still derive the `name` from the GitHub URL if it is missing.

See `pack-spec.md` for the current feature set.

Run `$ uv run -m scripts.crawl --explain PathBox` to see what's going on.

---

* thecrawl also learned real version constraints

E.g.

```
    "releases": [
        {
            "sublime_text": "<4000",
            "version": "2.5.*"
        }
    ]
```

If that's in use, we may synthesize an automatic open-ended tags release.
This is so that a package only has to configure frozen, left-behind
version/st_build pairs while keeping the standard newest tag for newest build
semantic.

Concretely, for the example, we would add:

```json
        {
            "sublime_text": ">=4000",
            "tags": true
        }
```
automatically.


---

* Added snapshot_test.py for regression testing

In a nutshell, check out an older commit and run

```
$ uv run -m scripts.snapshot_test
```
then implement a feature or switch to your newest tip and run the command
again to see if your changes have unwanted side effects.  Refer the README
or the `--help` page.

