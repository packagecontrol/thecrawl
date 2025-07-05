---
layout: layout.njk
title: About / FAQ
---

# About

**Package Control <span class="hot">R</span>** is the community-driven package management solution for Sublime Text. It's a front-to-back, top-to-bottom, **r**ewrite of the original [packagecontrol.io](https://packagecontrol.io), managed entirely by the Sublime Text community.

The system consists of several components:

- [This website](https://packages.sublimetext.io), listing publicly available packages for Sublime Text.
- A [website listing libraries](http://packagecontrol.github.io) (a.k.a. dependencies) available for package authors.
- A [registry of packages](https://github.com/wbond/package_control_channel), where you can submit your package to be published here as well.
- A [crawler](https://github.com/packagecontrol/thecrawl) that finds new versions of all packages and makes them available to the site, and the Package Control package.
- The [Package Control package](https://packages.sublimetext.io/packages/Package%20Control/) that provides the user interface inside Sublime Text to find, install and update packages.

You can start using the hot newness today, by replacing all channels in your Package Control settings with the new one:

```sh
https://packages.sublimetext.io/channel.json
```

If you're still using Sublime Text 3 (please upgrade, 4 is _so much_ better), you can use `https://packages.sublimetext.io/channel_st3.json`.

## Why does the project exist?

The original Package Control is aging. It was built in a different time, when many of the tools we take for granted today were not available. It has seen some iterations during its time, but it has reached the end of the road in several ways. Most importantly, it's currently not possible for the community to ensure it's ongoing stability and performance.

Outages of certain aspects of the system, over the past year or so, have spurred members of the community (👏🙏 [@kaste](https://github.com/kaste)) to rebuild it from the ground up.

Most of the assets related to Package Control have originated from Will Bond's original work. These might eventually become available to the community. Even so, much of it simply needs a new approach that better fits the project's new "governance model".

## State of affairs

This project is a work in progress. Some features, like the number of times a package has been installed, are currently missing. How some of these aspects are resolved is TBD, pending more information about the future of [packagecontrol.io](https://packagecontrol.io) and related assets.

While the project is in flux, to not disturb users with potential breaking or disorienting changes, much of the user facing aspects remain unchanged. The package registry is still in it's "old" repository and might need to be moved eventually. And the "old" website is still up, and much more visible than this new one. The "old" `channel.json` is still the default that's included in the Package Control package.

However, the website is functionally very far along. And more importantly, the crawler and the `channel.json` it generates are fully functional and reliable.

## Other F.A.Q.

- Q. Will the libraries websites be merged into this one?
  - A. [Plausible](https://github.com/packagecontrol/thecrawl/pull/9)
