const fs = require("fs");

// rename macos and remove */any
function cleanupPlatforms(platforms) {
  return platforms
    .filter(platform => platform !== "*")
    .map(platform => platform === "osx" ? "macos" : platform);
}

// author can be string or array, convert to all arrays
function cleanupAuthors(author) {
  if (typeof author === 'string') {
    return [author];
  }
  return author;
}

function minimalPackage(pkg) {
  let platforms = [];

  pkg.releases.forEach(release => {
    platforms = platforms.concat(release.platforms);
    release.platforms = cleanupPlatforms(release.platforms);
  })

  return {
    name: pkg.name,
    author: cleanupAuthors(pkg.author),
    stars: pkg.stars ?? 0,
    releases: pkg.releases,
    labels: pkg.labels,
    platforms: cleanupPlatforms(platforms)
  }
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("static");

  const data = JSON.parse(fs.readFileSync("workspace.json", "utf8"));
  // eslint-disable-next-line no-unused-vars
  const live_packages = Object.entries(data.packages).map(([id, pkg]) => pkg).filter(pkg => !pkg.removed);

  // if readme is in pkg
  // transform some links
  // https://raw.githubusercontent.com/relikd/CUE-Sheet_sublime/main/README.md
  // => https://github.com/relikd/CUE-Sheet_sublime/blob/main/README.md
  //
  // https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/raw/master/README.md
  // => https://gitlab.com/patopest/sublime-text-cuelang-syntax/-/blob/master/README.md
  //
  // https://bitbucket.org/JeisonJHA/sublime-delphi-language/raw/master/README.md
  // => https://bitbucket.org/JeisonJHA/sublime-delphi-language/src/master/README.md
  //
  // and store the under readme_url
  eleventyConfig.addCollection("packages", () => {
    return live_packages.map(pkg => {
      let readme_url = pkg.readme;
      if (typeof readme_url === 'string') {
        // GitHub raw to blob
        readme_url = readme_url.replace(
          /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
          'https://github.com/$1/$2/blob/$3/$4'
        );
        // GitLab raw to blob
        readme_url = readme_url.replace(
          /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
          'https://gitlab.com/$1/$2/-/blob/$3/$4'
        );
        // Bitbucket raw to src
        readme_url = readme_url.replace(
          /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
          'https://bitbucket.org/$1/$2/src/$3/$4'
        );
      }
      return {
        ...pkg,
        ...minimalPackage(pkg),
        ...(readme_url !== pkg.readme ? { readme_url } : {})
      };
    });
  });

  eleventyConfig.addCollection("minimal_packages", () => {
    return live_packages.map(pkg => ({
      description: pkg.description,
      ...minimalPackage(pkg)
    })).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  });

  eleventyConfig.addCollection("updated_packages", () => {
    return live_packages.map(pkg => ({
      last_modified: pkg.last_modified,
      ...minimalPackage(pkg)
    })).sort((a, b) => {
      return new Date(b.last_modified ?? '1970-01-01 00:00:00') - new Date(a.last_modified ?? '1970-01-01 00:00:00')
    }).slice(0,9);
  });

  eleventyConfig.addCollection("newest_packages", () => {
    return live_packages.map(pkg => ({
      created_at: pkg.created_at,
      ...minimalPackage(pkg)
    })).sort((a, b) => {
      return new Date(b.created_at ?? '1970-01-01 00:00:00') - new Date(a.created_at ?? '1970-01-01 00:00:00')
    }).slice(0,9);
  });

  // simple to date string for some dates without times
  eleventyConfig.addFilter("date_format", (date) => {
    if (typeof date !== "string" ) return date;
    return (new Date(date)).toDateString();
  });

  return {
    dir: {
      input: ".",
      output: "_site",
    },
    passthroughFileCopy: true
  };
};
