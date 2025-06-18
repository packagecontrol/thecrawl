const fs = require("fs");

function minimalPackage(pkg) {
  return {
    name: pkg.name,
    author: pkg.author,
    releases: pkg.releases,
    labels: pkg.labels
  }
}

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("static");

  const data = JSON.parse(fs.readFileSync("workspace.json", "utf8"));

  eleventyConfig.addCollection("packages", () => {
    return Object.entries(data.packages).map(([id, pkg]) => ({
      ...pkg
    }));
  });

  eleventyConfig.addCollection("updated_packages", () => {
    return Object.entries(data.packages).map(([id, pkg]) => ({
      last_modified: pkg.last_modified,
      ...minimalPackage(pkg)
    })).sort((a, b) => {
      return new Date(b.last_modified ?? '1970-01-01 00:00:00') - new Date(a.last_modified ?? '1970-01-01 00:00:00')
    }).slice(0,9);
  });

  eleventyConfig.addCollection("newest_packages", () => {
    return Object.entries(data.packages).map(([id, pkg]) => ({
      first_seen: pkg.first_seen,
      ...minimalPackage(pkg)
    })).sort((a, b) => {
      return new Date(b.first_seen ?? '1970-01-01 00:00:00') - new Date(a.first_seen ?? '1970-01-01 00:00:00')
    }).slice(0,9);
  });

  eleventyConfig.addFilter("slice", (arr, start, end) => {
    if (!Array.isArray(arr)) return [];
    return arr.slice(start, end);
  });

  // disambiguate package names that would result in the same slug
  eleventyConfig.addFilter("preslug", (str) => {
    if (! typeof str === "string" ) return str;
    return str.replace("+", "plus").replace("C#", "C-Sharp");
  });

  eleventyConfig.addFilter("date_format", (date) => {
    if (! typeof date === "string" ) return str;
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
