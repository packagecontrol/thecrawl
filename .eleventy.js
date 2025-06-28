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

  eleventyConfig.addCollection("packages", () => {
    return live_packages.map(pkg => ({
      ...pkg,
      ...minimalPackage(pkg)
    }));
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
