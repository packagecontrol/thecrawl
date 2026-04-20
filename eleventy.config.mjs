import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { minify } from 'terser'
import * as util from './eleventy.util.mjs'
import * as filters from './eleventy.filters.mjs'

const repackagerSite = 'https://repackager.sublimetext.io'
const supportedRepackagerHosts = [
  'https://codeload.github.com/',
  'https://bitbucket.org/',
  'https://codelab.org/',
  'https://gitlab.com/',
]
const FEATURED_LABELS = [
  'language syntax',
  'snippets',
  'linting',
  'auto-complete',
  'color scheme',
  'theme',
]
const LABELS_RANK = new Map(FEATURED_LABELS.map((label, index) => [label, index]))

const MS_IN_DAY = 24 * 60 * 60 * 1000
const MAGIC_FRESHNESS_WINDOW_DAYS = 365 * 2 // bonus for packages that had updates
const MAGIC_LONGEVITY_WINDOW_DAYS = 365 * 10 // Advertise newer packages
const MAGIC_RECENT_UPDATE_DAYS = 90 // extra bonus for just updated packages
const MAGIC_WEIGHTS = {
  popularity: 0.4,
  stars: 0.3,
  freshness: 0.2,
  longevity: 0.1,
  recency: 0.05,
}
const STATUS_TAG_WINDOW_DAYS = 30
const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

const clamp01 = value => Math.max(0, Math.min(1, value))
// GitHub-style emoji shortcode mapping, loaded from JSON.
// Extend emoji.json over time as needed.
const EMOJI_MAP = Object.freeze(JSON.parse(fs.readFileSync('emoji.json', 'utf8')))

function translateEmojiCodes(text) {
  if (!text || typeof text !== 'string') return text

  const emojiPattern = /:([a-zA-Z0-9_+-]+):/g
  return text.replace(emojiPattern, (match, code) => {
    const normalized = String(code || '').trim()
    if (!normalized) return match
    return EMOJI_MAP[normalized] || match
  })
}

function normalizeLog(value, maxValue) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return 0
  }
  return Math.log1p(value) / Math.log1p(maxValue)
}

function toTimestamp(value) {
  if (!value) {
    return null
  }

  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isNaN(time) ? null : time
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }

  const str = String(value).trim()
  if (!str) {
    return null
  }

  if (/^\d+$/.test(str)) {
    const num = Number(str)
    if (!Number.isFinite(num)) {
      return null
    }
    return str.length > 10 ? num : num * 1000
  }

  const isoCandidate = str.includes('T') || str.endsWith('Z')
    ? str
    : `${str.replace(' ', 'T')}Z`
  const parsed = Date.parse(isoCandidate)
  return Number.isNaN(parsed) ? null : parsed
}

function collectStatusTagData({ days = STATUS_TAG_WINDOW_DAYS } = {}) {
  const cutoff = Date.now() - days * MS_IN_DAY
  const semverTags = readStatusSemverTags()

  const windowTags = []
  let overflowTag = null

  for (const tag of semverTags) {
    const ts = Date.parse(tag.date)
    if (!Number.isFinite(ts)) continue

    if (ts >= cutoff) {
      windowTags.push(tag)
      continue
    }

    overflowTag = tag
    break
  }

  return { windowTags, overflowTag }
}

function readStatusSemverTags() {
  const git = spawnSync(
    'git',
    [
      'for-each-ref',
      '--sort=-taggerdate',
      '--format=%(refname:short)\t%(taggerdate:iso-strict)',
      'refs/tags',
    ],
    { encoding: 'utf8' },
  )

  if (git.status !== 0) {
    const reason = (git.stderr || git.stdout || '').trim() || `exit code ${git.status}`
    console.warn(`[eleventy] Failed to load git tags for status markers: ${reason}`)
    return []
  }

  return git.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [tag, taggerDate] = line.split('\t')
      return { tag: String(tag || '').trim(), date: String(taggerDate || '').trim() }
    })
    .filter(({ tag, date }) => tag && date)
    .filter(({ tag }) => SEMVER_TAG_RE.test(tag))
}

function computeMagicMetadata(packages) {
  const now = Date.now()
  const maxStars = packages.reduce((max, pkg) => Math.max(max, pkg.stars ?? 0), 0)
  const maxInstalls = packages.reduce((max, pkg) => Math.max(max, pkg.installs_window ?? 0), 0)

  return packages.map((pkg) => {
    const installsScore = normalizeLog(pkg.installs_window ?? 0, maxInstalls)
    const starsScore = normalizeLog(pkg.stars ?? 0, maxStars)

    const lastModifiedTs = toTimestamp(pkg.last_modified) ?? toTimestamp(pkg.created_at) ?? toTimestamp(pkg.first_seen)
    const createdTs = toTimestamp(pkg.created_at) ?? toTimestamp(pkg.first_seen)

    const ageDaysSinceUpdate = lastModifiedTs ? (now - lastModifiedTs) / MS_IN_DAY : Infinity
    const P = 8
    const freshnessScore = Number.isFinite(ageDaysSinceUpdate)
      ? clamp01(1 - (ageDaysSinceUpdate / MAGIC_FRESHNESS_WINDOW_DAYS) ** P)
      : 0
    const recentUpdateBonus = Number.isFinite(ageDaysSinceUpdate)
      ? clamp01(1 - (ageDaysSinceUpdate / MAGIC_RECENT_UPDATE_DAYS) ** P)
      : 0

    const ageDaysSinceCreation = createdTs ? (now - createdTs) / MS_IN_DAY : null
    const longevityScore = ageDaysSinceCreation === null
      ? 0
      : clamp01(1 - (ageDaysSinceCreation / MAGIC_LONGEVITY_WINDOW_DAYS))

    const penalty = (pkg.removed || pkg.outdated) ? 0.4 : 0

    const weightedPopularity = MAGIC_WEIGHTS.popularity * installsScore
    const weightedStars = MAGIC_WEIGHTS.stars * starsScore
    const weightedFreshness = MAGIC_WEIGHTS.freshness * freshnessScore
    const weightedLongevity = MAGIC_WEIGHTS.longevity * longevityScore
    const weightedRecency = MAGIC_WEIGHTS.recency * recentUpdateBonus

    const baseScore
      = weightedPopularity
      + weightedStars // eslint-disable-line @stylistic/indent-binary-ops
      + weightedFreshness
      + weightedLongevity
      + weightedRecency
      - penalty

    const withPrecision = value => Number(value.toFixed(4))
    const magicBreakdown = {
      popularity: withPrecision(weightedPopularity),
      stars: withPrecision(weightedStars),
      freshness: withPrecision(weightedFreshness),
      longevity: withPrecision(weightedLongevity),
      recency: withPrecision(weightedRecency),
      penalty: withPrecision(-penalty),
    }
    const clampedScore = withPrecision(clamp01(baseScore))

    return {
      ...pkg,
      magic_score: clampedScore,
      magic: magicBreakdown,
    }
  })
}

function basePackage(pkg, stat) {
  // Create a new array of releases with cleaned platforms
  const rawReleases = pkg.releases || []
  const releases = rawReleases.map(release => ({
    ...release,
    // Used for release list display and for grouping releases with identical platform sets.
    platforms: util.prettifyPlatformLabels(release.platforms),
  }))

  const supportsModernSublime = releases.some((release) => {
    return util.parseSublimeTextMin(release.sublime_text) >= 3000
  })
  const doesNotSupportNewestSublime = releases.every((release) => {
    return util.parseSublimeTextMax(release.sublime_text) < 4000
  })

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
      const m = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/zip\/(.+)$/.exec(url)
      if (m) {
        const [, owner, repo, tag] = m
        const tag_ = encodeURIComponent(tag)
        release.web = `https://github.com/${owner}/${repo}/releases/tag/${tag_}`
      }
    }
    // Provide repackager links if possible
    if (supportedRepackagerHosts.some(n => url.startsWith(n))) {
      const encodedName = encodeURIComponent(pkg.name)
      release.download_url = `${repackagerSite}/packages/${encodedName}?url=${url}`
    }
  }

  const { mainReleases, otherReleases } = util.weightReleases(releases)

  const allReleases = [...releases].sort((a, b) => {
    const dateA = new Date(a.date ?? '1970-01-01 00:00:00')
    const dateB = new Date(b.date ?? '1970-01-01 00:00:00')
    if (dateA.getTime() !== dateB.getTime()) {
      return dateB - dateA // Newest first
    }
    const minA = util.parseSublimeTextMin(a.sublime_text)
    const minB = util.parseSublimeTextMin(b.sublime_text)
    return minB - minA // Higher min build first
  })

  let labels = util.sortFeaturedLabelsFirst(pkg.labels, LABELS_RANK)
  if (pkg.failing_since || pkg.fail_reason) {
    labels.unshift('FAILING')
  }
  if (!supportsModernSublime) {
    labels.unshift('ST2')
  } else if (doesNotSupportNewestSublime) {
    labels.unshift('ST3')
  }
  if (pkg.removed) {
    labels.unshift('RIP')
  } else if (pkg.archived_at) {
    labels.unshift('MIA')
  }

  const platforms = util.computePlatformLabelsForSearch(rawReleases).sort()

  return {
    name: pkg.name,
    author: util.cleanAuthors(pkg.author) ?? [],
    stars: pkg.stars ?? 0,
    installed: stat?.installs?.totals ?? 0,
    first_seen: pkg.first_seen,
    created_at: pkg.created_at,
    last_modified: pkg.last_modified,
    archived_at: pkg.archived_at,
    removed: pkg.removed,
    releases: mainReleases,
    otherReleases,
    allReleases,
    labels: labels,
    // Aggregated platform tokens for search indexing and platform: filtering.
    platforms: platforms,
    // Human-readable label shown on cards and package stats/labels.
    platform_statement: util.computePlatformStatement(platforms),
    outdated: !supportsModernSublime,
    st3_only: supportsModernSublime && doesNotSupportNewestSublime,
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
  const prodOrigin = 'https://packages.sublimetext.io'
  const devOrigin = process.env.DEV_ORIGIN || 'http://localhost:8080'
  const siteOrigin = isProd ? prodOrigin : devOrigin

  eleventyConfig.addPassthroughCopy('assets')
  eleventyConfig.addPassthroughCopy({ static: isProd ? 'static_' + util.gitHash : 'static' })

  eleventyConfig.ignores.add('.AFileIcon')
  eleventyConfig.ignores.add('util')
  eleventyConfig.ignores.add('README.md')
  eleventyConfig.ignores.add('**/*.test.js')

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
  if (typeof limitRaw === 'string' && limitRaw.trim() !== '') {
    const numeric = parseInt(limitRaw, 10)
    if (Number.isFinite(numeric) && numeric !== 0) {
      const before = all_packages.length
      const limit = Math.abs(numeric)
      const installsFor = (pkg) => {
        const yearly = stats[pkg.name]?.installs?.yearly
        if (!Array.isArray(yearly)) return 0
        return yearly.reduce((sum, value) => sum + (Number(value) || 0), 0)
      }
      const timestampFor = pkg => toTimestamp(pkg.first_seen) ?? 0
      const byNewest = [...all_packages].sort((a, b) => {
        const tsA = timestampFor(a)
        const tsB = timestampFor(b)
        return numeric > 0 ? tsB - tsA : tsA - tsB
      }).slice(0, Math.ceil(limit / 2))
      const byPopular = [...all_packages].sort((a, b) => {
        const instA = installsFor(a)
        const instB = installsFor(b)
        return numeric > 0 ? instB - instA : instA - instB
      })

      const limited = []
      const seen = new Set()
      const pushUnique = (pkg) => {
        if (!pkg || seen.has(pkg.name)) {
          return
        }
        seen.add(pkg.name)
        limited.push(pkg)
      }
      byNewest.forEach(pushUnique)
      if (limited.length < limit) {
        for (const pkg of byPopular) {
          pushUnique(pkg)
          if (limited.length >= limit) break
        }
      }
      all_packages = limited
      const modeLabel = numeric > 0 ? '' : '(oldest/unpopular mix)'
      console.warn(`[eleventy] LIMIT_DATASET=${numeric} active ${modeLabel}: ${before} -> ${all_packages.length} packages`)
    } else {
      const names = limitRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean)
      if (names.length > 0) {
        const nameSet = new Set(names)
        const before = all_packages.length
        all_packages = all_packages.filter(pkg => nameSet.has(String(pkg.name || '').toLowerCase()))
        console.warn(`[eleventy] LIMIT_DATASET=[${names.join(', ')}] active: ${before} -> ${all_packages.length} packages`)
      }
    }
  }

  eleventyConfig.addCollection('packages', () => {
    return all_packages.map((pkg) => {
      const readme_url = util.getReadmeUrl(pkg.readme)
      const stat = stats[pkg.name]
      const weekly_installs = stat?.installs?.weekly ?? []
      const weekly_removals = stat?.removals?.weekly ?? []
      const weekly_upgrades = stat?.upgrades?.weekly ?? []
      const weekly_dates = stats['__weekly_dates']

      // Trim stats to the package lifetime based on first_seen
      let end = undefined
      if (pkg.first_seen && weekly_dates) {
        const iso = util.isoWeekString(pkg.first_seen)
        const idx = weekly_dates.indexOf(iso)
        if (idx >= 0) {
          end = idx + 1
        }
      }

      return {
        weekly_dates: weekly_dates,
        weekly_installs: weekly_installs.slice(0, end),
        weekly_removals: weekly_removals.slice(0, end),
        weekly_upgrades: weekly_upgrades.slice(0, end),
        ...pkg,
        description: translateEmojiCodes(pkg.description ?? ''),
        ...basePackage(pkg, stats[pkg.name]),
        ...(readme_url !== pkg.readme ? { readme_url } : {}),
      }
    })
  })

  eleventyConfig.addCollection('searchable_packages', () => {
    const searchable = all_packages.map(pkg => ({
      description: translateEmojiCodes(pkg.description ?? ''),
      installs_window: stats[pkg.name]?.installs?.yearly?.reduce((a, b) => a + b) ?? 0,
      ...basePackage(pkg, stats[pkg.name]),
    }))
    const withMagic = computeMagicMetadata(searchable)
    return withMagic.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
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
      return new Date(b.first_seen ?? '1970-01-01 00:00:00') - new Date(a.first_seen ?? '1970-01-01 00:00:00')
    }).slice(0, 9)
  })

  eleventyConfig.addCollection('newest_packages_feed', () => {
    return all_packages
      .filter(pkg => !pkg.removed && pkg.first_seen)
      .map(pkg => ({
        ...basePackage(pkg, stats[pkg.name]),
        description: translateEmojiCodes(pkg.description ?? ''),
        guid: pkg.id ?? pkg.name,
      }))
      .sort((a, b) => {
        return new Date(b.first_seen ?? '1970-01-01 00:00:00') - new Date(a.first_seen ?? '1970-01-01 00:00:00')
      })
      .slice(0, 25)
  })

  eleventyConfig.addCollection('labels', () => {
    const labels = {}

    all_packages.map((pkg) => {
      if (!pkg.labels) {
        return
      }

      pkg.labels.forEach((label) => {
        if (labels[label]) {
          labels[label]++
        } else {
          labels[label] = 1
        }
      })
    })

    return Object.entries(labels)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count }))
  })

  eleventyConfig.addCollection('libraries', () => {
    const libraries = JSON.parse(fs.readFileSync('libraries.json', 'utf8'))
    const dataset = util.collectPlatformDataset(libraries.libraries)
    return libraries.libraries.map((lib) => {
      const base = normalizedLib(lib)
      return {
        ...base,
        platforms: util.simplifyPlatforms(dataset, base.platforms),
      }
    })
  })

  eleventyConfig.addGlobalData('built', () => {
    const now = new Date()
    return {
      timestamp: now.toISOString(),
      formatted: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      year: now.getFullYear(),
    }
  })

  eleventyConfig.addGlobalData('site', {
    origin: siteOrigin,
    prodOrigin,
    devOrigin,
    disableLiveLink: Boolean(process.env.DISABLE_L_LINK),
  })

  const statusTagData = collectStatusTagData()
  eleventyConfig.addGlobalData('status_tag_dates_json', () => {
    return JSON.stringify(statusTagData.windowTags)
  })
  eleventyConfig.addGlobalData('status_tag_overflow_json', () => {
    return statusTagData.overflowTag ? JSON.stringify(statusTagData.overflowTag) : 'null'
  })

  // Default permalink: output files with their extension (e.g., /page.html)
  // Can be overridden per-template (e.g., RSS feed or JSON endpoints)
  eleventyConfig.addGlobalData('permalink', () => {
    return data => `${data.page.filePathStem}.${data.page.outputFileExtension}`
  })

  // Remove .html from computed page.url to create extensionless URLs
  eleventyConfig.addUrlTransform((page) => {
    if (page.url && page.url.endsWith('.html')) {
      return page.url.slice(0, -1 * '.html'.length)
    }
  })

  // Register all named exports from external module as filters
  for (const [name, fn] of Object.entries(filters)) {
    eleventyConfig.addFilter(name, fn)
  }

  return {
    dir: {
      input: '.',
      output: '_site',
    },
    passthroughFileCopy: true,
  }
}
