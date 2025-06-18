const fs = require("fs");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("static");

  const data = JSON.parse(fs.readFileSync("workspace.json", "utf8"));

  eleventyConfig.addCollection("packages", () => {
    return Object.entries(data.packages).map(([id, pkg]) => ({
      ...pkg,
      id,
    }));
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
