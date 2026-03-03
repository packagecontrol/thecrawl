
What's been cooking
===================


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

