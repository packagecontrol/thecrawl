---
layout: layout.njk
title: About / FAQ
---

# About

**Package Control <span class="hot">R</span>** is the community-driven package management solution for Sublime Text. It's a front-to-back, top-to-bottom, **r**ewrite of the original [packagecontrol.io](https://packagecontrol.io), managed entirely by the Sublime Text community.

The system consists of several components:

- [This website](https://packages.sublimetext.io), listing publicly available packages for Sublime Text.
- A [website listing libraries](http://packagecontrol.github.io) (a.k.a. dependencies) available for package authors.
- A [registry of packages](https://github.com/wbond/package_control_channel), where you can submit your package to be published here.
- A [crawler](https://github.com/packagecontrol/thecrawl) that finds new versions of all packages and makes them available to the site, and to the Package Control package.
- The [Package Control package](https://packages.sublimetext.io/packages/Package%20Control/) that provides the user interface inside Sublime Text to find, install and update packages.

You can start using the hot newness today, by replacing the existing channel in your Package Control package settings with the new one:

```sh
https://packages.sublimetext.io/channel.json
```

If you're still using Sublime Text 3, you can use:  
`https://packages.sublimetext.io/channel_st3.json`

## Why does this website exist?

The original [Package Control](https://packagecontrol.io) is aging. It was built in a different time, when many of the tools we take for granted today were not available. It has seen some iterations during its time, but it has reached the end of the road in several ways. Most importantly, it's currently not possible for the community to ensure its ongoing stability and performance.

Outages of certain aspects of the system, over the past year or so, have spurred members of the community (🙇‍♂️ [@kaste](https://github.com/kaste) and the entire crew) to rebuild it from the ground up.

Building this while keeping the original in place, allows us to iterate towards feature-completeness and stability. This also enables us to find new solutions that better fit the project's new "governance model". Eventually, hopefully we will be able to fully replace Will Bond's original project (and domain name), but these things take time to organize properly.

## State of affairs

This project is a work in progress. Some features, like counting how often a package has been installed, are currently missing. While the project is in flux, to not disturb users with potential breaking or disorienting changes, much of the user facing aspects of Package Control remain unchanged.  
The package registry is still in it's "old" GitHub repository, and might be moved eventually. And the "old" website is still up, and much more visible than this new one. The "old" `channel.json` is still the default that's included in the Package Control package.

However, the website is functionally very far along, features all packages and is updated throughout the day with new release versions. And more importantly, the crawler and the `channel.json` it generates, are fully functional and very reliable. 

You are very much invited to make the switch and come along for the ride!

## Other F.A.Q.

- Q. Where can I ask questions?
  - A. On [discord](https://discord.sublimetext.io/): look for the "#package-control" channel.
- Q. Where can I contribute or report issues?
  - A. On [GitHub](https://github.com/packagecontrol/thecrawl/issues).
- Q. Will the libraries website be merged into this one?
  - A. [Plausible](https://github.com/packagecontrol/thecrawl/pull/9)


<script type="module">
  document.querySelectorAll('pre').forEach(codeblock => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('clipboard-wrapper');
    const button = document.createElement('button');
    button.innerText = 'Copy';
    button.classList.add('button');
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigator.clipboard.writeText(codeblock.innerText.trim());
      wrapper.classList.add('copied');
      window.setTimeout(() => {
        wrapper.classList.remove('copied');
      }, 200);
    }
    codeblock.insertAdjacentElement('beforebegin', wrapper);
    wrapper.appendChild(codeblock);
    wrapper.appendChild(button)
  });
</script>
