const fs = require("fs");
const { EleventyHtmlBasePlugin } = require("@11ty/eleventy");

function cleanupPlatforms(platforms) {
  return platforms
    .filter(platform => platform !== "*")
    .map(platform => platform === "osx" ? "macos" : platform);
}

function minimalPackage(pkg) {
  let platforms = [];

  pkg.releases.forEach(release => {
    platforms = platforms.concat(release.platforms);
    release.platforms = cleanupPlatforms(release.platforms);
  })

  return {
    name: pkg.name,
    author: pkg.author,
    stars: pkg.stars ?? 0,
    releases: pkg.releases,
    labels: pkg.labels,
    platforms: cleanupPlatforms(platforms)
  }
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("static");
  eleventyConfig.addPlugin(EleventyHtmlBasePlugin);

  const data = JSON.parse(fs.readFileSync("workspace.json", "utf8"));
  const live_packages = Object.entries(data.packages).map(([id, pkg]) => pkg).filter(pkg => !pkg.removed);

  eleventyConfig.addCollection("packages", () => {
    return live_packages.map(pkg => ({
      ...minimalPackage(pkg),
      ...pkg
    }));
  });

  eleventyConfig.addCollection("minimal_packages", () => {
    return live_packages.map(pkg => ({
      description: pkg.description,
      ...minimalPackage(pkg)
    })).sort((a, b) => a.name.localeCompare(b.name));
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

  // disambiguate package names that would result in the same slug
  eleventyConfig.addFilter("preslug", (str) => {
    if (! typeof str === "string" ) return str;
    return str.replace("+", "plus").replace("C#", "C-Sharp");
  });

  // simple to date string for some dates without times
  eleventyConfig.addFilter("date_format", (date) => {
    if (! typeof date === "string" ) return str;
    return (new Date(date)).toDateString();
  });

  return {
    dir: {
      input: ".",
      output: "_site",
    },
    passthroughFileCopy: true,
  };
};
