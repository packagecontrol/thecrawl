import fs from 'node:fs'

export default class RepackagerIndex {
  data() {
    return {
      eleventyExcludeFromCollections: true,
      permalink: '/repackager-index.json',
    }
  }

  render() {
    const workspace = JSON.parse(fs.readFileSync('workspace.json', 'utf8'))
    return JSON.stringify(repackagerIndexFor(workspace))
  }
}

function repackagerIndexFor(workspace) {
  const packages = {}

  for (const [name, pkg] of Object.entries(workspace.packages)) {
    const urls = [...new Set((pkg.releases ?? []).map(release => release.url))]
    if (urls.length) {
      packages[name] = urls
    }
  }

  return {
    schema_version: 1,
    packages,
  }
}
