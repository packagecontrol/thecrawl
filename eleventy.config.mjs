import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { minify } from 'terser'
import * as esbuild from 'esbuild'
import * as util from './eleventy.util.mjs'
import * as filters from './eleventy.filters.mjs'
import { bundleCss } from './util/bundle-css.mjs'
import {
  RENDERED_READMES_ENVIRONMENT_KEY,
  createReadmeRendererEnvironmentHash,
} from './util/readme-render-cache.mjs'

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
const LABEL_ICON_MINIMUM_USAGE = 3
const LABEL_ICON_RECENT_WINDOW_DAYS = 365
// The main chart width is 53 weeks; + 1 for a possible continuation line
const INSTALL_CHART_WEEKS = 53 + 1
const INSTALL_WINDOW_YEARS = 3
const INSTALL_WINDOW_WEEKS = 53 * INSTALL_WINDOW_YEARS
const INSTALL_THREE_YEAR_THRESHOLD_WEEKS = 52 * INSTALL_WINDOW_YEARS

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
const SEMVER_TAG_RE = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const STATUS_TAG_WINDOW_DAYS = 30
const SUCCESSOR_NOTICE_WINDOW_DAYS = 365
const HOME_SECTION_PACKAGE_LIMIT = 9
const REMARKABLE_PACKAGE_LIMIT = 40
const REMARKABLE_EXCLUDED_PACKAGE_NAMES = new Set(['Package Control'])
const REMARKABLE_EXCLUDED_PACKAGE_PREFIXES = ['LSP-', 'SublimeLinter-']

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

  const semverTags = git.stdout
    .split(/\r?\n/)
    .map((line) => {
      const [tag, taggerDate] = line.split('\t')
      return { tag: String(tag || '').trim(), date: String(taggerDate || '').trim() }
    })
    .filter(({ tag, date }) => tag && date)
    .filter(({ tag }) => SEMVER_TAG_RE.test(tag))
    .filter(({ date }) => Number.isFinite(Date.parse(date)))

  return statusTagsForChartWindow(semverTags)
}

function statusTagsForChartWindow(tags, {
  days = STATUS_TAG_WINDOW_DAYS,
  nowTimestamp = Date.now(),
} = {}) {
  const cutoff = nowTimestamp - Math.max(0, Math.floor(days)) * MS_IN_DAY
  const selected = []

  for (const tag of tags) {
    // The status chart needs tags in its visible day window plus exactly the
    // newest older tag for the left-edge overflow marker.
    // Hence break after push.
    selected.push(tag)
    if (Date.parse(tag.date) < cutoff) break
  }

  return selected
}

function computeMagicMetadata(packages) {
  const now = Date.now()
  const maxStars = packages.reduce((max, pkg) => Math.max(max, pkg.stars ?? 0), 0)
  const maxInstalls = packages.reduce((max, pkg) => Math.max(max, pkg.installs_recent ?? 0), 0)

  return packages.map((pkg) => {
    const installsScore = normalizeLog(pkg.installs_recent ?? 0, maxInstalls)
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

export function basePackage(pkg) {
  // Create a new array of releases with cleaned platforms
  const rawReleases = pkg.releases || []
  const releases = rawReleases.map(release => ({
    ...release,
    // Used for release list display and for grouping releases with identical platform sets.
    platforms: util.prettifyPlatformLabels(release.platforms),
  }))

  const compatibility = util.computeSublimeCompatibility(releases)

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
  if (compatibility === 'st2') {
    labels.unshift('ST2')
  } else if (compatibility === 'st3') {
    labels.unshift('ST3')
  }
  if (pkg.removed) {
    labels.unshift('RIP')
  } else if (pkg.archived_at) {
    labels.unshift('MIA')
  }

  const platforms = util.computePlatformLabelsForSearch(rawReleases).sort()

  return {
    author: util.cleanAuthors(pkg.author) ?? [],
    description: translateEmojiCodes(pkg.description ?? ''),
    stars: pkg.stars ?? 0,
    releases: mainReleases,
    otherReleases,
    allReleases,
    labels: labels,
    declared_primary_label: pkg.labels?.[0] ?? '',
    // Aggregated platform tokens for search indexing and platform: filtering.
    platforms: platforms,
    // Human-readable label shown on cards and package stats/labels.
    platform_statement: util.computePlatformStatement(platforms),
    compatibility,
    outdated: compatibility === 'st2',
  }
}

function normalizedLib(pkg) {
  const releases = pkg.releases ?? []
  const platforms = util.computePlatformLabelsForSearch(releases).sort()

  return {
    name: pkg.name,
    homepage: pkg.homepage ?? pkg.issues?.replace('/issues', '') ?? '',
    author: util.cleanAuthors(pkg.author) ?? [],
    description: translateEmojiCodes(pkg.description ?? ''),
    releases,
    latest_version: pkg.latest_version ?? latestReleaseVersion(releases),
    platforms,
    platform_statement: libraryPlatformStatement(platforms),
  }
}

function libraryPlatformStatement(platforms) {
  const statement = util.computePlatformStatement(platforms)
  if (!statement || /^(Only|Not)\b/.test(statement)) {
    return statement
  }
  return `Only for: ${statement}`
}

function latestReleaseVersion(releases) {
  return [...releases]
    .sort((a, b) => new Date(b.date ?? '1970-01-01 00:00:00') - new Date(a.date ?? '1970-01-01 00:00:00'))
    .find(release => release.version)?.version ?? ''
}

function isEligibleForRemarkableSection(name, alreadyFeatured) {
  return !alreadyFeatured.has(name)
    && !REMARKABLE_EXCLUDED_PACKAGE_NAMES.has(name)
    && !REMARKABLE_EXCLUDED_PACKAGE_PREFIXES.some(prefix => name.startsWith(prefix))
}

function compareRemarkablePackages(a, b) {
  const scoreDelta = (b.magic_score ?? 0) - (a.magic_score ?? 0)
  if (scoreDelta !== 0) {
    return scoreDelta
  }

  return a.name.localeCompare(b.name)
}

const vendorModules = [
  {
    source: 'node_modules/dompurify/dist/purify.es.mjs',
    output: 'dompurify/purify.es.mjs',
  },
  {
    source: 'node_modules/marked/lib/marked.esm.js',
    output: 'marked/marked.esm.js',
  },
  {
    source: 'node_modules/minisearch/dist/es/index.js',
    output: 'minisearch/index.js',
  },
]

export default async function (eleventyConfig) {
  const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'
  const prodOrigin = 'https://packages.sublimetext.io'
  const devOrigin = process.env.DEV_ORIGIN || 'http://localhost:8080'
  const siteOrigin = isProd ? prodOrigin : devOrigin
  const staticOutputDir = isProd ? 'static_' + util.gitHash : 'static'
  const dataOutputDir = isProd ? 'data_' + util.dataVersion : 'data'
  const bundledScriptEntries = new Set()
  let labelIcons = null

  eleventyConfig.addPassthroughCopy(
    { static: staticOutputDir },
    {
      filter: src => !src.endsWith('.test.js')
        && !src.endsWith('logs.json')
        && !src.endsWith('label-icons.svg')
        && !src.endsWith('label-icons-extra.svg'),
    },
  )
  eleventyConfig.addPassthroughCopy({ 'static/logs.json': `${dataOutputDir}/logs.json` })
  eleventyConfig.addWatchTarget('./eleventy.install-chart.mjs')

  eleventyConfig.on('eleventy.before', () => {
    bundledScriptEntries.clear()
  })

  eleventyConfig.on('eleventy.after', async ({ directories } = {}) => {
    const outputDir = directories?.output ?? '_site'
    await writeVendorModules(path.join(outputDir, staticOutputDir, 'vendor'))
    writeLabelIconSprites(
      'static/label-icons.svg',
      path.join(outputDir, dataOutputDir),
      labelIcons,
    )

    if (!isProd) {
      return
    }

    await bundleJs(path.join(outputDir, staticOutputDir), bundledScriptEntries, isProd)
    bundleCss(path.join(outputDir, `static_${util.gitHash}`, 'styles.css'))
  })

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
  const allWeeklyDates = stats['__weekly_dates'] ?? []
  const installWindowStart = allWeeklyDates.length >= INSTALL_WINDOW_WEEKS ? 1 : 0
  const installWindowDates = allWeeklyDates.slice(installWindowStart, INSTALL_WINDOW_WEEKS)
  const installHistory = installHistoryFor(installWindowDates)

  let renderedReadmes = fs.existsSync('readmes_rendered.json')
    ? JSON.parse(fs.readFileSync('readmes_rendered.json', 'utf8'))
    : {}
  if (renderedReadmes[RENDERED_READMES_ENVIRONMENT_KEY] === createReadmeRendererEnvironmentHash()) {
    console.warn('[eleventy] Using pre-rendered READMEs from readmes_rendered.json')
  } else {
    const renderedReadmesStale = Object.keys(renderedReadmes).length > 0
    console.warn(
      '[eleventy] All READMEs are fetched and rendered live in the browser. '
      + 'Tip: run `node render_readmes.mjs -i readmes.json -o readmes_rendered.json` '
      + `to prerender READMEs${renderedReadmesStale ? ' again' : ''}.`,
    )
    renderedReadmes = {}
  }

  let sourceModel = {}
  if (fs.existsSync('source-model.json')) {
    console.warn('[eleventy] Using source-model.json for deep links')
    sourceModel = JSON.parse(fs.readFileSync('source-model.json', 'utf8'))
  } else {
    console.warn(
      '[eleventy] source-model.json not available, only fallback source links will be rendered. '
      + 'Tip: run `make build-source-map`.',
    )
  }

  let all_packages = util.simplifyPackageLabels(
    // eslint-disable-next-line no-unused-vars
    Object.entries(workspace.packages).map(([id, pkg]) => pkg),
  )
  const successionMetadata = packageSuccessionMetadata(all_packages)

  // Optional dataset limiting for faster local dev
  const limitRaw = process.env.LIMIT_DATASET
  if (typeof limitRaw === 'string' && limitRaw.trim() !== '') {
    const numeric = parseInt(limitRaw, 10)
    if (Number.isFinite(numeric) && numeric !== 0) {
      const before = all_packages.length
      const limit = Math.abs(numeric)
      const installsFor = (pkg) => {
        const weekly = stats[pkg.name]?.installs?.weekly
        if (!Array.isArray(weekly)) return 0
        return weekly.slice(installWindowStart, INSTALL_WINDOW_WEEKS)
          .reduce((sum, value) => sum + (Number(value) || 0), 0)
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

  const packages = all_packages.map(packageData)
  const packagesWithMagic = computeMagicMetadata(packages)
  const labels = util.collectLabels(all_packages)

  const livingHomePackages = packages.filter(pkg => !pkg.removed)

  const packagesByDate = (field) => {
    return [...livingHomePackages].sort((a, b) => {
      return new Date(b[field] ?? '1970-01-01 00:00:00') - new Date(a[field] ?? '1970-01-01 00:00:00')
    })
  }

  const newestHomePackages = packagesByDate('first_seen').slice(0, HOME_SECTION_PACKAGE_LIMIT)
  const updatedHomePackages = packagesByDate('last_modified').slice(0, HOME_SECTION_PACKAGE_LIMIT)
  const latestPackageUpdate = livingHomePackages.reduce(
    (latest, pkg) => Math.max(latest, new Date(pkg.last_modified ?? 0).getTime() || 0),
    0,
  )
  const recentCutoff = latestPackageUpdate - LABEL_ICON_RECENT_WINDOW_DAYS * MS_IN_DAY
  const recentlyUpdatedPackages = livingHomePackages.filter(
    pkg => new Date(pkg.last_modified ?? 0).getTime() >= recentCutoff,
  )
  labelIcons = filters.configureLabelIcons(labels, {
    minimumUsage: LABEL_ICON_MINIMUM_USAGE,
    preferredPackages: [
      ...newestHomePackages,
      ...recentlyUpdatedPackages,
    ],
  })

  const remarkablePackages = () => {
    const alreadyFeatured = new Set()
    for (const pkg of newestHomePackages) {
      alreadyFeatured.add(pkg.name)
    }
    for (const pkg of updatedHomePackages) {
      alreadyFeatured.add(pkg.name)
    }

    return packagesWithMagic
      .filter(pkg =>
        !pkg.removed
        && !pkg.archived_at
        && isEligibleForRemarkableSection(pkg.name, alreadyFeatured))
      .sort(compareRemarkablePackages)
      .slice(0, REMARKABLE_PACKAGE_LIMIT)
  }

  eleventyConfig.addCollection('packages', () => packages)

  eleventyConfig.addCollection('searchable_packages', () => {
    return [...packagesWithMagic].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
  })

  eleventyConfig.addCollection('updated_packages', () => updatedHomePackages)

  eleventyConfig.addCollection('newest_packages', () => newestHomePackages)

  eleventyConfig.addCollection('remarkable_packages', () => remarkablePackages())

  eleventyConfig.addCollection('newest_packages_feed', () => {
    return packages
      .filter(pkg => !pkg.removed && pkg.first_seen)
      .sort((a, b) => {
        return new Date(b.first_seen ?? '1970-01-01 00:00:00') - new Date(a.first_seen ?? '1970-01-01 00:00:00')
      })
      .slice(0, 25)
      .map(pkg => ({
        ...pkg,
        guid: pkg.id ?? pkg.name,
      }))
  })

  function packageData(pkg) {
    const readme_url = util.getReadmeUrl(pkg.readme)
    const source_url = util.buildPackageSourceUrl(pkg, sourceModel)
    const stat = stats[pkg.name]
    const weekly_installs = (stat?.installs?.weekly ?? []).slice(0, INSTALL_CHART_WEEKS)
    const weekly_removals = (stat?.removals?.weekly ?? []).slice(0, INSTALL_CHART_WEEKS)
    const weekly_upgrades = (stat?.upgrades?.weekly ?? []).slice(0, INSTALL_CHART_WEEKS)
    const weekly_dates = allWeeklyDates.slice(0, INSTALL_CHART_WEEKS)

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
      ...pkg,
      ...basePackage(pkg),
      ...successionMetadata.get(pkg.name),
      weekly_dates: weekly_dates,
      weekly_installs: weekly_installs.slice(0, end),
      weekly_removals: weekly_removals.slice(0, end),
      weekly_upgrades: weekly_upgrades.slice(0, end),
      installs_total: stat?.installs?.totals ?? 0,
      installs_recent: (stat?.installs?.weekly ?? []).slice(installWindowStart, INSTALL_WINDOW_WEEKS)
        .reduce((sum, value) => sum + value, 0),
      installs_recent_period: installPeriod(pkg.first_seen, installWindowDates),
      ...(readme_url !== pkg.readme ? { readme_url } : {}),
      ...(renderedReadmes[pkg.readme] ? { rendered_readme: renderedReadmes[pkg.readme][1] } : {}),
      ...(source_url !== pkg.source ? { source_url } : {}),
    }
  }

  eleventyConfig.addCollection('labels', () => labels)

  eleventyConfig.addCollection('libraries', () => {
    return Object.values(workspace.libraries)
      .filter(lib => !lib.removed)
      .map(normalizedLib)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  })

  eleventyConfig.addGlobalData('install_history', installHistory)

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

  // Send the full tag history so the browser can decide what is visible and
  // what belongs behind the left-edge overflow pointer using the current day.
  const statusTags = readStatusSemverTags()
  eleventyConfig.addGlobalData('status_tag_dates_json', () => {
    return JSON.stringify(statusTags)
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

  let installChartModuleMtime = null
  let renderInstallChart = null
  async function loadInstallChartModule() {
    const mtime = fs.statSync('eleventy.install-chart.mjs').mtimeMs
    if (mtime === installChartModuleMtime) {
      return
    }

    installChartModuleMtime = mtime
    ;({ renderInstallChart } = await import(`./eleventy.install-chart.mjs?mtime=${mtime}`))
  }

  await loadInstallChartModule()
  eleventyConfig.on('eleventy.before', loadInstallChartModule)
  eleventyConfig.addFilter('install_chart', pkg => renderInstallChart(pkg))

  // Register all named exports from external module as filters
  for (const [name, fn] of Object.entries(filters)) {
    if (name === 'configureLabelIcons') continue
    eleventyConfig.addFilter(name, fn)
  }

  // `bundled` is both a URL filter and a build manifest collector. During a
  // render pass, each usage records a JS entry that `eleventy.after` bundles.
  // Clear the set in `eleventy.before` so watch-mode rebuilds do not keep
  // entries that were removed from templates.
  eleventyConfig.addFilter('bundled', p => bundledScriptUrl(p, bundledScriptEntries, isProd))

  return {
    dir: {
      input: '.',
      output: '_site',
    },
    passthroughFileCopy: true,
  }
}

export function packageSuccessionMetadata(packages, nowTimestamp = Date.now()) {
  const packagesByName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const metadata = new Map()

  for (const successor of packages) {
    if (successor.removed) continue

    const predecessors = (successor.previous_names ?? []).map(name => ({
      name,
      has_tombstone: Boolean(packagesByName.get(name)?.removed),
    }))
    if (predecessors.length === 0) continue

    for (const predecessor of predecessors) {
      metadata.set(predecessor.name, { successor_name: successor.name })
    }

    const firstSeen = toTimestamp(successor.first_seen)
    const noticeExpires = firstSeen + SUCCESSOR_NOTICE_WINDOW_DAYS * MS_IN_DAY
    if (firstSeen !== null && nowTimestamp < noticeExpires) {
      metadata.set(successor.name, { predecessors })
    }
  }

  return metadata
}

export function installHistoryFor(weeklyDates) {
  const oldestWeek = weeklyDates.at(-1)
  return {
    window_start: oldestWeek ? mondayOfIsoWeek(oldestWeek).getTime() / 1000 : 0,
    older_period: installPeriod(null, weeklyDates),
  }
}

export function installPeriod(firstSeen, weeklyDates) {
  const oldestWeek = weeklyDates.at(-1)
  if (!oldestWeek) {
    return 'recorded'
  }

  const firstSeenWeek = firstSeen ? util.isoWeekString(firstSeen) : null
  if (firstSeenWeek && firstSeenWeek >= oldestWeek) {
    return 'since added to Package Control'
  }

  if (weeklyDates.length >= INSTALL_THREE_YEAR_THRESHOLD_WEEKS) {
    return `in the past ${INSTALL_WINDOW_YEARS} years`
  }

  const oldestMonth = new Intl.DateTimeFormat('en', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(mondayOfIsoWeek(oldestWeek))
  const weeks = weeklyDates.length
  return `recorded since ${oldestMonth} (${weeks} ${weeks === 1 ? 'week' : 'weeks'})`
}

function mondayOfIsoWeek(isoWeek) {
  const match = /^(\d{4})-W(\d{2})$/.exec(isoWeek)
  const year = Number(match[1])
  const week = Number(match[2])
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4Day = jan4.getUTCDay() || 7
  return new Date(Date.UTC(year, 0, 4 - jan4Day + 1 + ((week - 1) * 7)))
}

function writeLabelIconSprites(sourcePath, outputDir, labelIcons) {
  if (!(labelIcons?.primarySources instanceof Set) || !fs.existsSync(sourcePath)) {
    return
  }

  const source = fs.readFileSync(sourcePath, 'utf8')
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(
    path.join(outputDir, 'label-icons.svg'),
    labelIconSpriteForSources(source, labelIcons.primarySources),
    'utf8',
  )
  fs.writeFileSync(
    path.join(outputDir, 'label-icons-extra.svg'),
    labelIconSpriteForSources(source, labelIcons.secondarySources),
    'utf8',
  )
}

function labelIconSpriteForSources(source, sources) {
  return source.replace(
    /<symbol\b[^>]*\bid="label-icon-([^"]+)"[^>]*>[\s\S]*?<\/symbol>\r?\n?/g,
    (symbol, iconSource) => sources.has(iconSource) ? symbol : '',
  )
}

async function bundleJs(staticOutputDir, entries, isProd) {
  if (!entries.size) {
    return
  }

  await esbuild.build({
    entryPoints: jsBundleEntryPoints(staticOutputDir, entries),
    outdir: path.join(staticOutputDir, 'bundle'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: isProd,
    sourcemap: true,
    splitting: false,
  })
}

function bundledScriptUrl(p, entries, isProd) {
  const match = String(p).match(/^(\/?)static\/([^/]+\.js)$/)
  if (!match) {
    throw new Error(`[bundled] Expected /static/<entry>.js, got ${p}`)
  }

  const [, leadingSlash, fileName] = match
  entries.add(fileName)

  if (!isProd) {
    return p
  }

  return `${leadingSlash}static_${util.gitHash}/bundle/${fileName}`
}

function jsBundleEntryPoints(staticOutputDir, entries) {
  return Object.fromEntries(
    [...entries].sort().map(fileName => [
      path.basename(fileName, '.js'),
      path.join(staticOutputDir, fileName),
    ]),
  )
}

async function writeVendorModules(vendorOutputDir) {
  for (const vendorModule of vendorModules) {
    const source = fs.readFileSync(vendorModule.source, 'utf8')
    const minified = await minify(source, {
      compress: true,
      mangle: true,
      ecma: 2022,
      module: true,
    })

    const outputPath = path.join(vendorOutputDir, vendorModule.output)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, minified.code || source)
  }
}
