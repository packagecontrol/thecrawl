import fs from 'fs'
import path from 'path'
import { minify } from 'terser'
import * as util from './eleventy.util.mjs'

function basePackage(pkg, stats) {
  // Create a new array of releases with cleaned platforms
  const releases = (pkg.releases || []).map(release => ({
    ...release,
    platforms: util.cleanPlatforms(release.platforms),
  }))

  // For each release, infer a human web URL under key "web"
  // Rules:
  // - GitLab: replace any "/-/..." suffix with "/-/tags"
  // - GitHub:
  //   https://codeload.github.com/<owner>/<repo>/zip/<tag>
  //   => https://github.com/<owner>/<repo>/releases/tag/<tag>
  for (const release of releases) {
    const url = release.url ?? ''
    if (url.startsWith('https://gitlab.com/')) {
      const idx = url.indexOf('/-/')
      if (idx !== -1) {
        release.web = url.slice(0, idx) + '/-/tags'
      }
    } else if (
      url.startsWith('https://codeload.github.com/')
      // check if the version looks like a "branch"-fallback version
      && !/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(release.version ?? '')
    ) {
      const m = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/zip\/([^/]+)$/.exec(url)
      if (m) {
        const [, owner, repo, tag] = m
        release.web = `https://github.com/${owner}/${repo}/releases/tag/${tag}`
      }
    }
  }

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
  const total_installs = stats?.installs?.totals ?? 0
  const total_removals = stats?.removals?.totals ?? 0
  const net_installs = Math.max(0, total_installs - total_removals)
  const weekly_installs = stats?.installs?.weekly ?? []
  const weekly_removals = stats?.removals?.weekly ?? []
  const weekly_upgrades = stats?.upgrades?.weekly ?? []

  return {
    name: pkg.name,
    author: util.cleanAuthors(pkg.author) ?? [],
    stars: pkg.stars ?? 0,
    installed: net_installs,
    created_at: pkg.created_at,
    last_modified: pkg.last_modified,
    archived_at: pkg.archived_at,
    removed: pkg.removed,
    doa: pkg.removed && !pkg.first_seen,
    releases: dedupedReleases,
    otherReleases,
    labels: pkg.labels,
    platforms: uniquePlatforms,
    weekly_installs,
    weekly_removals,
    weekly_upgrades,
  }
}

function normalizedLib(pkg) {
  const allPlatforms = pkg.releases.flatMap((release) => {
    if (typeof release.platforms !== 'undefined') {
      return release.platforms
    }
    return []
  })

  const homepage = pkg.issues.replace('/issues', '')
  let gh_path = ''
  if (homepage.startsWith('https://github.com/')) {
    gh_path = homepage.replace('https://github.com/', '')
  }

  return {
    name: pkg.name,
    homepage: homepage,
    path: gh_path,
    author: util.cleanAuthors(pkg.author),
    description: pkg.description,
    releases: pkg.releases,
    labels: [],
    platforms: Array.from(new Set(allPlatforms)),
  }
}

export default function (eleventyConfig) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'

  eleventyConfig.addPassthroughCopy('assets')
  eleventyConfig.addPassthroughCopy({ static: isProd ? 'static_' + util.gitHash : 'static' })

  eleventyConfig.ignores.add('README.md')

  const inlineJsCache = new Map()
  eleventyConfig.addAsyncShortcode('inline_js', async (relPath) => {
    const filePath = path.isAbsolute(relPath) ? relPath : path.join(process.cwd(), relPath)
    const stat = fs.statSync(filePath)
    const cacheKey = JSON.stringify({ path: filePath, mtime: stat.mtimeMs, prod: isProd })
    if (inlineJsCache.has(cacheKey)) {
      return inlineJsCache.get(cacheKey)
    }

    let code = fs.readFileSync(filePath, 'utf8')

    if (isProd) {
      try {
        const out = await minify(code, {
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
    const out = `<script>${safe}</script>`
    inlineJsCache.set(cacheKey, out)
    return out
  })

  const workspace = JSON.parse(fs.readFileSync('workspace.json', 'utf8'))
  const stats = JSON.parse(fs.readFileSync('stats.json', 'utf8'))
  // eslint-disable-next-line no-unused-vars
  let all_packages = Object.entries(workspace.packages).map(([id, pkg]) => pkg)

  // Optional dataset limiting for faster local dev
  const limitRaw = process.env.LIMIT_DATASET
  const limit = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : NaN
  const shouldLimit = Number.isFinite(limit) && limit > 0
  if (shouldLimit) {
    const before = all_packages.length
    all_packages = all_packages.slice(0, limit)
    console.warn(`[eleventy] LIMIT_DATASET=${limit} active: ${before} -> ${all_packages.length} packages`)
  }

  eleventyConfig.addCollection('packages', () => {
    return all_packages.map((pkg) => {
      const readme_url = util.getReadmeUrl(pkg.readme)
      return {
        ...pkg,
        ...basePackage(pkg, stats[pkg.name]),
        weekly_dates: stats['__weekly_dates'],
        ...(readme_url !== pkg.readme ? { readme_url } : {}),
      }
    })
  })

  eleventyConfig.addCollection('searchable_packages', () => {
    return all_packages.map(pkg => ({
      description: pkg.description,
      ...basePackage(pkg, stats[pkg.name]),
    })).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
  })

  eleventyConfig.addCollection('updated_packages', () => {
    return all_packages.filter(pkg => !pkg.removed).map(pkg => ({
      ...basePackage(pkg, stats[pkg.name]),
    })).sort((a, b) => {
      return new Date(b.last_modified ?? '1970-01-01 00:00:00') - new Date(a.last_modified ?? '1970-01-01 00:00:00')
    }).slice(0, 9)
  })

  eleventyConfig.addCollection('newest_packages', () => {
    return all_packages.filter(pkg => !pkg.removed).map(pkg => ({
      ...basePackage(pkg, stats[pkg.name]),
    })).sort((a, b) => {
      return new Date(b.created_at ?? '1970-01-01 00:00:00') - new Date(a.created_at ?? '1970-01-01 00:00:00')
    }).slice(0, 9)
  })

  eleventyConfig.addCollection('libraries', () => {
    const libraries = JSON.parse(fs.readFileSync('libraries.json', 'utf8'))
    return libraries.libraries.map(lib => ({
      ...normalizedLib(lib),
    }))
  })

  eleventyConfig.addGlobalData('built', () => {
    const now = new Date()
    return {
      timestamp: now.toISOString(),
      formatted: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      year: now.getFullYear(),
    }
  })

  // simple to date string for some dates without times
  eleventyConfig.addFilter('date_format', (date) => {
    if (typeof date !== 'string') return date
    const value = new Date(date)
    return (new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })).format(value)
  })

  // simple to date string for some dates _with_ times
  eleventyConfig.addFilter('date_time_format', (date) => {
    return (new Date(date)).toISOString().slice(0, 16).replace('T', ' ')
  })

  // number of seconds since epoch, to facilitate comparisons in search
  eleventyConfig.addFilter('timestamp', (date) => {
    if (typeof date !== 'string') return date
    return (new Date(date)).getTime() / 1000
  })

  // compact number formatting (e.g. 10k)
  eleventyConfig.addFilter('compact', (count) => {
    const fmt = new Intl.NumberFormat('en', { notation: 'compact' })
    return fmt.format(count)
  })

  // number formatting with grouping (e.g. 10,000)
  eleventyConfig.addFilter('grouping', (count) => {
    const fmt = new Intl.NumberFormat('en', { useGrouping: true })
    return fmt.format(count)
  })

  // slice: provide arr.slice to the templates
  eleventyConfig.addFilter('slice', (arr, start, end = undefined) => {
    return arr.slice(start, end)
  })

  // max: provide Math.max to the templates
  eleventyConfig.addFilter('max', (arr, defaultValue = 0) => {
    return Math.max(defaultValue, ...(Array.isArray(arr) ? arr : [arr]))
  })

  // cache bust static files
  eleventyConfig.addFilter('bust', (p) => {
    if (!isProd) return p
    return p.replace('static/', 'static_' + util.gitHash + '/')
  })

  return {
    dir: {
      input: '.',
      output: '_site',
    },
    passthroughFileCopy: true,
  }
}
