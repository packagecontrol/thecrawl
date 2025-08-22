const fs = require('fs')
const path = require('path')
const execSync = require('child_process').execSync

const gitHash = execSync('git rev-parse --short HEAD').toString().trim()

// rename macos and remove */any
function cleanupPlatforms(platforms) {
  return platforms
    .filter(platform => platform !== '*')
    .map(platform => platform === 'osx' ? 'macos' : platform)
}

// author can be string or array, convert to all arrays
function cleanupAuthors(author) {
  if (typeof author === 'string') {
    return [author]
  }
  return author
}

function minimalPackage(pkg, stats) {
  // Create a new array of releases with cleaned platforms
  const releases = (pkg.releases || []).map(release => ({
    ...release,
    platforms: cleanupPlatforms(release.platforms),
  }))

  // sort releases by date, newest first
  // secondary by .sublime_text. strip the leading non-digit from that string first, reverse alphabetical
  releases.sort((a, b) => {
    const dateA = new Date(a.date ?? '1970-01-01 00:00:00')
    const dateB = new Date(b.date ?? '1970-01-01 00:00:00')
    if (dateA.getTime() !== dateB.getTime()) {
      return dateB - dateA // Newest first
    }
    // Secondary: compare .sublime_text, strip leading non-digit, reverse alphabetical
    const verA = (a.sublime_text || '').replace(/^[^\d]*/, '')
    const verB = (b.sublime_text || '').replace(/^[^\d]*/, '')
    if (verA > verB) return -1
    if (verA < verB) return 1
    return 0
  })

  // Split releases with same sublime build and same platform set.
  // As we're sorted, just keep the first one we see.
  const seen = new Set()
  const dedupedReleases = []
  const otherReleases = []
  for (const release of releases) {
    const key = `${release.sublime_text}|${[...release.platforms].sort().join('|')}`
    if (!seen.has(key)) {
      seen.add(key)
      dedupedReleases.push(release)
    }
    else {
      otherReleases.push(release)
    }
  }

  // Remove duplicate platforms
  const allPlatforms = releases.flatMap(release => release.platforms)
  const uniquePlatforms = Array.from(new Set(allPlatforms))
  const stat = typeof stats === 'undefined' ? 0 : Math.max(0, stats['install'] - stats['remove'])

  return {
    name: pkg.name,
    author: cleanupAuthors(pkg.author) ?? [],
    stars: pkg.stars ?? 0,
    installed: stat,
    created_at: pkg.created_at,
    last_modified: pkg.last_modified,
    archived_at: pkg.archived_at,
    removed: pkg.removed,
    doa: pkg.removed && !pkg.first_seen,
    releases: dedupedReleases,
    otherReleases,
    labels: pkg.labels,
    platforms: uniquePlatforms,
  }
}

function minimalLib(pkg) {
  const allPlatforms = pkg.releases.flatMap((release) => {
    if (typeof release.platforms !== 'undefined') {
      return release.platforms
    }
    return []
  })
  const uniquePlatforms = Array.from(new Set(allPlatforms))

  const homepage = pkg.issues.replace('/issues', '')
  let gh_path = ''
  if (homepage.startsWith('https://github.com/')) {
    gh_path = homepage.replace('https://github.com/', '')
  }

  return {
    name: pkg.name,
    homepage: homepage,
    path: gh_path,
    author: cleanupAuthors(pkg.author),
    description: pkg.description,
    releases: pkg.releases,
    labels: [],
    platforms: uniquePlatforms,
  }
}

module.exports = function (eleventyConfig) {
  // Inline JS shortcode with optional minification via Terser
  const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'

  eleventyConfig.addAsyncShortcode('inline_js', async (relPath) => {
    const filePath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath)
    let code = fs.readFileSync(filePath, 'utf8')

    if (isProd) {
      const terser = require('terser')
      try {
        const out = await terser.minify(code, {
          compress: true,
          mangle: true,
          ecma: 2022,
          module: false,
          toplevel: false,
        })
        if (out.error) throw out.error
        code = out.code || code
      } catch (e) {
        console.warn(`[inline_js] Minification failed for ${relPath}: ${e && e.message ? e.message : e}`)
      }
    }

    // Prevent closing tag from breaking inline script
    const safe = code.replace(/<\/script>/gi, '<\\/script>')
    return `<script>${safe}</script>`
  })

  eleventyConfig.addWatchTarget('_includes/human_date.js')
  eleventyConfig.addPassthroughCopy('assets')
  eleventyConfig.addPassthroughCopy({ static: 'static_' + gitHash })

  const libraries = JSON.parse(fs.readFileSync('libraries.json', 'utf8'))
  const workspace = JSON.parse(fs.readFileSync('workspace.json', 'utf8'))
  const stats = JSON.parse(fs.readFileSync('stats.json', 'utf8'))
  // eslint-disable-next-line no-unused-vars
  const all_packages = Object.entries(workspace.packages).map(([id, pkg]) => pkg)

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
  eleventyConfig.addCollection('packages', () => {
    return all_packages.map((pkg) => {
      let readme_url = pkg.readme
      if (typeof readme_url === 'string') {
        // GitHub raw to blob
        readme_url = readme_url.replace(
          /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
          'https://github.com/$1/$2/blob/$3/$4',
        )
        // GitLab raw to blob
        readme_url = readme_url.replace(
          /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
          'https://gitlab.com/$1/$2/-/blob/$3/$4',
        )
        // Bitbucket raw to src
        readme_url = readme_url.replace(
          /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
          'https://bitbucket.org/$1/$2/src/$3/$4',
        )
      }
      return {
        ...pkg,
        ...minimalPackage(pkg, stats[pkg.name]),
        ...(readme_url !== pkg.readme ? { readme_url } : {}),
      }
    })
  })

  eleventyConfig.addCollection('minimal_packages', () => {
    return all_packages.map(pkg => ({
      description: pkg.description,
      ...minimalPackage(pkg, stats[pkg.name]),
    })).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
  })

  eleventyConfig.addCollection('updated_packages', () => {
    return all_packages.filter(pkg => !pkg.removed).map(pkg => ({
      ...minimalPackage(pkg, stats[pkg.name]),
    })).sort((a, b) => {
      return new Date(b.last_modified ?? '1970-01-01 00:00:00') - new Date(a.last_modified ?? '1970-01-01 00:00:00')
    }).slice(0, 9)
  })

  eleventyConfig.addCollection('newest_packages', () => {
    return all_packages.filter(pkg => !pkg.removed).map(pkg => ({
      ...minimalPackage(pkg, stats[pkg.name]),
    })).sort((a, b) => {
      return new Date(b.created_at ?? '1970-01-01 00:00:00') - new Date(a.created_at ?? '1970-01-01 00:00:00')
    }).slice(0, 9)
  })

  eleventyConfig.addCollection('libraries', () => {
    return libraries.libraries.map(lib => ({
      ...minimalLib(lib),
    }))
  })

  // simple to date string for some dates without times
  eleventyConfig.addFilter('date_format', (date) => {
    if (typeof date !== 'string') return date
    const value = new Date(date)
    return (new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })).format(value)
  })

  eleventyConfig.addFilter('date_time_format', (date) => {
    return (new Date(date)).toISOString().slice(0, 16).replace('T', ' ')
  })

  // number of seconds since epoch, to facilitate comparisons in search
  eleventyConfig.addFilter('timestamp', (date) => {
    if (typeof date !== 'string') return date
    return (new Date(date)).getTime() / 1000
  })

  eleventyConfig.addFilter('compact', (count) => {
    const fmt = new Intl.NumberFormat('en', { notation: 'compact' })
    return fmt.format(count)
  })

  eleventyConfig.addFilter('grouping', (count) => {
    const fmt = new Intl.NumberFormat('en', { useGrouping: true })
    return fmt.format(count)
  })

  eleventyConfig.addFilter('bust', (path) => {
    return path.replace('static/', 'static_' + gitHash + '/')
  })

  return {
    dir: {
      input: '.',
      output: '_site',
    },
    passthroughFileCopy: true,
  }
}
