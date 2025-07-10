<!-- https://github.com/wbond/package_control/blob/master/example-dependencies.json -->

# Examples for the dependencies.json

This might be completely outdated? See also dependencies.md.

This file is a filesystem-level solution for specifying libraries for packages. This is most useful for package developers since they are not installing their own packages from a repository or channel, and need to make sure Package Control installs the libraries they need.

The file contains two levels of selectors, platform and Sublime Text version, to pick what set of libraries should be installed. The most-specific selectors will be used, and all other ignored. This means that some libraries will be duplicated under a specific platform and under *.

The first level of keys should be the value from sublime.platform(), or `*` for all platforms.

The second level should be a version selector, like used for the sublime_text value in package releases. 

Matching of platform and version selectors is exclusive. Thus, those libraries will only be installed if no other keys matched first.


```json
{
	"$schema": "sublime://packagecontrol.io/schemas/dependencies",

	"windows": {
		"<3000": [
			"select-windows",
			"cffi",
			"cryptography",
			"pyOpenSSL"
		]
	},
	"*": {
		"*": [
			"cffi",
			"cryptography",
			"pyOpenSSL"
		]
	}
}
```
