import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'
const NBSP = '\u00A0'

const LABEL_ALIAS_TARGETS = JSON.parse(fs.readFileSync(
  new URL('./label-aliases.json', import.meta.url),
  'utf8',
))
const LABEL_ALIASES = new Map(
  Object.entries(LABEL_ALIAS_TARGETS).flatMap(([target, aliases]) => {
    if (target === '_') return []
    return aliases.map(alias => [alias.trim().toLowerCase(), target])
  }),
)

const canonicalizeOs = (platform) => {
  const lower = platform.toLowerCase()
  if (lower === '*') return 'any'
  return lower.replace('osx', 'macos')
}

const prettifyOs = (platform) => {
  return platform
    .replace('macos', 'macOS')
    .replace('linux', 'Linux')
    .replace('windows', 'Windows')
}

/**
 * Prettify platform labels for display (canonicalize tokens then apply casing).
 * @param {string[]} platforms
 * @returns {string[]}
 */
export function prettifyPlatformLabels(platforms) {
  return platforms
    .map(canonicalizeOs)
    .map(prettifyOs)
}

/**
 * Compute platform labels for search.
 * Input platforms come straight from the workspace (osx/linux/windows, its variants, or "*"),
 * so normalize to lower-case tokens, map osx -> macos and "*" -> any, then dedupe and
 * collapse full OS coverage to ["any"].
 * @param {Array<{platforms?: Array<string>}>} releases
 * @returns {string[]}
 */
export function computePlatformLabelsForSearch(releases) {
  const all = releases.flatMap(release => release.platforms ?? [])
  const normalized = all.map(canonicalizeOs).filter(Boolean)
  const unique = Array.from(new Set(normalized))
  if (unique.includes('any')) {
    return ['any']
  }
  // when a package actually supports all platforms (across multiple releases)
  if (unique.includes('linux') && unique.includes('windows') && unique.includes('macos')) {
    return ['any']
  }
  return unique
}

/**
 * Move featured labels to the front while preserving stable order.
 * - Featured labels are ordered by rank.
 * - Non-featured labels keep their original relative order.
 * @param {string[] | undefined | null} labels
 * @param {Map<string, number> | undefined | null} rank
 * @returns {string[]}
 */
export function sortFeaturedLabelsFirst(labels = [], rank = new Map()) {
  return [...labels].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity))
}

/**
 * Collect package label counts for the labels page.
 *
 * Package labels are normalized before this runs, so this only aggregates the
 * already chosen display labels.
 *
 * @param {Array<{labels?: string[]}>} packages
 * @returns {Array<{key: string, count: number}>}
 */
export function collectLabels(packages) {
  const counts = new Map()

  for (const pkg of packages) {
    const labelsInPackage = new Set(pkg.labels ?? [])
    for (const label of labelsInPackage) {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  return Array.from(counts, ([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Normalize package labels once after loading workspace data.
 *
 * This gives package cards, package pages, search, and the labels page the same
 * canonical spellings while retaining a note about visible rewrites for package
 * maintainers.
 *
 * @param {Array<{labels?: string[]}>} packages
 * @returns {Array<{labels?: string[], normalized_labels?: Array<{from: string, to: string}>}>}
 */
export function simplifyPackageLabels(packages) {
  const resolveLabel = buildLabelResolver(packages)
  return packages.map(pkg => simplifyPackageLabelSet(pkg, resolveLabel))
}

/**
 * Build a package-global label normalizer.
 *
 * The first pass groups every observed spelling by identity. Identity folds
 * configured aliases first, then lowercases, so `autocomplete` and
 * `auto-complete` land in the same bucket.
 *
 * The second pass chooses one display label per bucket. Configured aliases win
 * (for example `autocomplete` -> `auto-complete`); otherwise we keep the most
 * frequently observed spelling/casing from the dataset.
 */
function buildLabelResolver(packages) {
  const labels = new Map()

  for (const pkg of packages) {
    for (const label of pkg.labels ?? []) {
      const configuredTarget = labelAlias(label)
      // Bucket related spellings together, including configured aliases.
      const canonical = (configuredTarget ?? label).trim().toLowerCase()
      let entry = labels.get(canonical)
      if (!entry) {
        entry = {
          // Preferred configured target, if any spelling in this bucket has one.
          aliasTarget: null,
          // Raw observed spellings and counts, used when there is no alias.
          variants: new Map(),
        }
        labels.set(canonical, entry)
      }

      if (configuredTarget && !entry.aliasTarget) {
        entry.aliasTarget = configuredTarget
      }
      entry.variants.set(label, (entry.variants.get(label) ?? 0) + 1)
    }
  }

  const displayLabels = new Map()
  for (const [canonical, entry] of labels) {
    displayLabels.set(canonical, displayLabelForEntry(entry))
  }

  return (label) => {
    const configuredTarget = labelAlias(label)
    const canonical = (configuredTarget ?? label).trim().toLowerCase()
    return displayLabels.get(canonical) ?? label
  }
}

function displayLabelForEntry(entry) {
  // This bucket matched an explicit rule in label-aliases.json, so use the
  // desired canonical label from the left hand side of that file.
  if (entry.aliasTarget) {
    return entry.aliasTarget
  }

  // No explicit alias rule matched. This bucket only contains labels that are
  // identical after lowercasing, so choose the spelling/casing users already
  // use most often in the dataset.
  return mostFrequentLabelVariant(entry.variants)
}

function simplifyPackageLabelSet(pkg, resolveLabel) {
  if (!pkg.labels) {
    return pkg
  }

  const labels = []
  const seenLabels = new Set()
  const changes = []
  const seenChanges = new Set()

  for (const label of pkg.labels) {
    const simplified = resolveLabel(label)
    const canonical = simplified.trim().toLowerCase()

    if (label !== simplified) {
      const key = `${label}\0${simplified}`
      if (!seenChanges.has(key)) {
        seenChanges.add(key)
        changes.push({ from: label, to: simplified })
      }
    }

    if (seenLabels.has(canonical)) {
      continue
    }
    seenLabels.add(canonical)
    labels.push(simplified)
  }

  if (changes.length === 0 && labels.length === pkg.labels.length) {
    return pkg
  }

  return {
    ...pkg,
    labels,
    normalized_labels: changes,
  }
}

function labelAlias(label) {
  return LABEL_ALIASES.get(label.trim().toLowerCase()) ?? null
}

function mostFrequentLabelVariant(variants) {
  let winner = null

  for (const [key, count] of variants) {
    if (!winner || count > winner.count) {
      winner = { key, count }
    }
  }

  return winner.key
}

/**
 * Build a human-readable platform statement for cards.
 * Input is already canonicalized (lowercase tokens like macos/linux/windows/any).
 */
export function computePlatformStatement(platforms) {
  if (!platforms.length) return ''
  if (platforms.includes('any')) return ''
  if (platforms.some(token => token === 'osx' || token.startsWith('osx-'))) {
    throw new Error(`computePlatformStatement received non-canonicalized platform: ${platforms.join(', ')}`)
  }

  const tokens = []
  const variantsByOs = new Map()
  const baseTokens = new Set()
  const isBaseOs = value => value === 'macos' || value === 'linux' || value === 'windows'

  platforms.forEach((token) => {
    if (isBaseOs(token)) {
      baseTokens.add(token)
      tokens.push({ kind: 'base', os: token })
      return
    }

    const match = /^([^-]+)-(.+)$/.exec(token)
    if (match) {
      const os = match[1]
      if (isBaseOs(os)) {
        const variant = match[2]
        if (!variantsByOs.has(os)) variantsByOs.set(os, new Set())
        variantsByOs.get(os).add(variant)
        tokens.push({ kind: 'variant', os, variant })
        return
      }
    }

    tokens.push({ kind: 'other', raw: token })
  })

  const collapseOs = new Set(baseTokens)
  for (const [os, variants] of variantsByOs.entries()) {
    if (os === 'windows' && variants.has('x64')) {
      collapseOs.add(os)
    }
    if ((os === 'linux' || os === 'macos') && variants.has('x64') && variants.has('arm64')) {
      collapseOs.add(os)
    }
  }

  const collapsed = []
  const seen = new Set()
  const addToken = (token) => {
    const key = `${token.kind}:${token.os ?? ''}:${token.variant ?? ''}:${token.raw ?? ''}`.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    collapsed.push(token)
  }

  tokens.forEach((token) => {
    if (token.kind === 'base') {
      addToken({ kind: 'base', os: token.os })
      return
    }
    if (token.kind === 'variant') {
      if (collapseOs.has(token.os)) {
        addToken({ kind: 'base', os: token.os })
        return
      }
      addToken(token)
      return
    }
    addToken(token)
  })

  const baseOrder = ['linux', 'windows', 'macos']
  const baseOnly = collapsed.length > 0 && collapsed.every(token => token.kind === 'base')
  if (baseOnly) {
    const baseSet = new Set(collapsed.map(token => token.os))
    if (baseOrder.every(os => baseSet.has(os))) return ''
    if (collapsed.length === 1) return `Only for ${prettifyOs(collapsed[0].os)}`
    if (collapsed.length === 2) {
      const missing = baseOrder.find(os => !baseSet.has(os))
      return missing ? `Not for ${prettifyOs(missing)}` : ''
    }
  }

  const variantOnly = collapsed.length === 3 && collapsed.every(token => token.kind === 'variant')
  if (variantOnly) {
    const osSet = new Set(collapsed.map(token => token.os))
    const variantSet = new Set(collapsed.map(token => token.variant))
    if (baseOrder.every(os => osSet.has(os)) && variantSet.size === 1) {
      const variant = variantSet.values().next().value
      if (variant === 'x32' || variant === 'x64') {
        return `Only on ${variant}`
      }
    }
  }

  if (collapsed.length === 1 && collapsed[0].kind === 'variant') {
    const token = collapsed[0]
    return `Only on ${platformTokenLabel(token)}`
  }

  const labels = collapsed.map(platformTokenLabel)

  // Keep the slash with the preceding platform when wrapping.
  return labels.join(`${NBSP}/ `)
}

function platformTokenLabel(token) {
  if (token.kind === 'base') return prettifyOs(token.os)
  if (token.kind === 'variant') return `${prettifyOs(token.os)}‑${token.variant}`
  // Replace normal hyphens to non-breaking hyphens
  return token.raw.replaceAll('-', '‑')
}

/**
 * Author can be string or array: convert to all arrays.
 */
export function cleanAuthors(author) {
  if (typeof author === 'string') {
    return [author]
  }
  return author
}

/**
 * Split releases with same sublime build and same platform set.
 * Sorting is internal: higher min build first, then newest date first.
 * Keep the first one; if it's a pre-release, also keep the next stable.
 */
export function weightReleases(releases) {
  const sortedReleases = [...(releases ?? [])].sort((a, b) => {
    const minA = parseSublimeTextMin(a?.sublime_text)
    const minB = parseSublimeTextMin(b?.sublime_text)
    if (minA !== minB) {
      return minB - minA
    }
    const dateA = new Date(a?.date ?? '1970-01-01 00:00:00')
    const dateB = new Date(b?.date ?? '1970-01-01 00:00:00')
    return dateB - dateA
  })

  const seen = new Map()
  const mainReleases = []
  const otherReleases = []
  for (const release of sortedReleases) {
    const platforms = [...(release.platforms ?? [])].sort().join('|')
    const key = `${release.sublime_text}|${platforms}`
    const isPreRelease = (release.version ?? '').includes('-')
    if (!seen.has(key)) {
      seen.set(key, { firstWasPreRelease: isPreRelease, keptStable: !isPreRelease })
      mainReleases.push(release)
    } else {
      const state = seen.get(key)
      if (state.firstWasPreRelease && !state.keptStable && !isPreRelease) {
        state.keptStable = true
        mainReleases.push(release)
      } else {
        otherReleases.push(release)
      }
    }
  }

  return { mainReleases, otherReleases }
}

/**
 * Convert links for the raw readme data to one for the file blob.
 */
export function getReadmeUrl(readme) {
  if (typeof readme !== 'string') {
    return null
  }
  return toLiveFileUrl(readme)
}

/**
 * Convert source registry URLs to an editable web URL.
 */
export function getSourceUrl(source) {
  if (typeof source !== 'string') {
    return null
  }

  const live = toLiveFileUrl(source)
  return live.replace(
    /^https:\/\/github\.com\/wbond\/package_control_channel\/blob\//,
    'https://github.com/sublimehq/package_control_channel/blob/',
  )
}

const TRUSTED_CHANNEL_SOURCE_URL_RE = /^(https:\/\/github\.com\/sublimehq\/package_control_channel\/blob\/[^/]+)\/.+$/
const _JSON_NAME_LINE_RE = /^\s*"name":\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/
const _JSON_DETAILS_LINE_RE = /^\s*"details":\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/

/**
 * @typedef {string} PackageName
 */

/**
 * Build a trusted tracker source URL with file path and line anchor when available.
 * @param {{ source?: string, name?: string }} pkg
 * @param {Map<PackageName, { relativePath: string, lineNumber: number }>} trustedTrackerLineIndex
 * @returns {string | null}
 */
export function buildPackageSourceUrl(pkg, trustedTrackerLineIndex) {
  const sourceUrl = getSourceUrl(pkg.source)
  if (!sourceUrl || !pkg.name) {
    return sourceUrl
  }

  const lineRef = trustedTrackerLineIndex.get(pkg.name)
  if (!lineRef) {
    return sourceUrl
  }

  const match = sourceUrl.match(TRUSTED_CHANNEL_SOURCE_URL_RE)
  if (!match) {
    return sourceUrl
  }

  return `${match[1]}/${lineRef.relativePath}#L${lineRef.lineNumber}`
}

/**
 * Build package name -> source file/line index from trusted tracker repository includes.
 * @param {string} repositoryPath
 * @returns {Map<PackageName, { relativePath: string, lineNumber: number }>}
 */
export function buildTrustedTrackerLineIndex(repositoryPath) {
  const repositoryAbsolutePath = path.resolve(process.cwd(), repositoryPath)
  if (!fs.existsSync(repositoryAbsolutePath)) {
    console.warn(`[eleventy] Missing trusted repository at ${repositoryAbsolutePath}`)
    return new Map()
  }

  const rootDir = path.dirname(repositoryAbsolutePath)
  const repositoryRelativePaths = getTrustedTrackerRepositoryFiles(repositoryAbsolutePath)
  const lineIndex = new Map()

  for (const relativePath of repositoryRelativePaths) {
    const bucketLineIndex = loadTrustedTrackerLineMap(rootDir, relativePath)
    for (const [name, lineRef] of bucketLineIndex.entries()) {
      lineIndex.set(name, lineRef)
    }
  }

  return lineIndex
}

/**
 * Resolve trusted repository include paths from repository.json.
 * Paths are normalized as project-root-relative (without leading "./").
 * @param {string} repositoryPath
 * @returns {Array<string>}
 */
function getTrustedTrackerRepositoryFiles(repositoryPath) {
  const includes = JSON.parse(fs.readFileSync(repositoryPath, 'utf8')).includes

  return includes
    .filter(include => path.basename(include) !== 'dependencies.json')
    .map(include => include.replace(/^\.\//, '').replace(/\\/g, '/'))
}

/**
 * @param {string} trackerRootDir
 * @param {string} relativePath
 * @returns {Map<PackageName, { relativePath: string, lineNumber: number }>}
 */
function loadTrustedTrackerLineMap(trackerRootDir, relativePath) {
  const trackerFilePath = path.join(trackerRootDir, relativePath)

  let trackerContents = null
  try {
    trackerContents = fs.readFileSync(trackerFilePath, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[eleventy] Failed to read trusted tracker source lines from ${trackerFilePath}: ${reason}`)
    return new Map()
  }

  const lineMap = new Map()
  const lines = trackerContents.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const lineNumber = index + 1

    const name = parseTrustedTrackerStringFieldLine(line, _JSON_NAME_LINE_RE)
    if (name) {
      lineMap.set(name, { relativePath, lineNumber })
      continue
    }

    const details = parseTrustedTrackerStringFieldLine(line, _JSON_DETAILS_LINE_RE)
    if (details) {
      let repo = null
      try {
        [, repo] = parseOwnerRepo(details)
      } catch {
        continue
      }

      if (!lineMap.has(repo)) {
        lineMap.set(repo, { relativePath, lineNumber })
      }
      continue
    }
  }

  return lineMap
}

function parseTrustedTrackerStringFieldLine(line, regex) {
  const match = line.match(regex)
  if (!match) {
    return null
  }

  return match[1]
}

/**
 * Extract package name from a trusted tracker package entry.
 * Prefer explicit "name", otherwise derive from the repo segment of "details" URL.
 */
export function extractPackageName(pkg) {
  if (pkg.name) {
    return pkg.name
  }

  if (!pkg.details) {
    return null
  }

  try {
    const [, repo] = parseOwnerRepo(pkg.details)
    return repo
  } catch {
    return null
  }
}

/**
 * Extract owner and repo from a *Hub URL.
 */
export function parseOwnerRepo(url) {
  const parts = new URL(url)
  const pathParts = parts.pathname.replace(/^\/+|\/+$/g, '').split('/')
  if (pathParts.length < 2) {
    throw new Error('Invalid *Hub repo URL')
  }
  return [pathParts[0], pathParts[1]]
}

function toLiveFileUrl(url) {
  // https://raw.githubusercontent.com/relikd/CUE-Sheet_sublime/main/README.md
  // => https://github.com/relikd/CUE-Sheet_sublime/blob/main/README.md
  //
  // https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json
  // => https://github.com/wbond/package_control_channel/blob/master/repository.json
  //
  // https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/raw/master/README.md
  // => https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/blob/master/README.md
  //
  // https://bitbucket.org/JeisonJHA/sublime-delphi-language/raw/master/README.md
  // => https://bitbucket.org/JeisonJHA/sublime-delphi-language/src/master/README.md
  //
  // https://codeberg.org/ISSOtm/sublime-Bison/raw/branch/master/README.md
  // => https://codeberg.org/ISSOtm/sublime-Bison/src/branch/master/README.md

  return url.replace( // GitHub raw (refs/*) to blob
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/refs\/(?:heads|tags)\/([^/]+)\/(.+)$/,
    'https://github.com/$1/$2/blob/$3/$4',
  ).replace( // GitHub raw to blob
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
    'https://github.com/$1/$2/blob/$3/$4',
  ).replace( // GitLab raw to blob
    /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
    'https://gitlab.com/$1/$2/-/blob/$3/$4',
  ).replace( // Bitbucket raw to src
    /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
    'https://bitbucket.org/$1/$2/src/$3/$4',
  ).replace( // Codeberg raw to src (branch paths)
    /^https:\/\/codeberg\.org\/([^/]+)\/([^/]+)\/raw\/branch\/([^/]+)\/(.+)$/,
    'https://codeberg.org/$1/$2/src/branch/$3/$4',
  )
}

/**
 * @typedef {'st2' | 'st3' | 'current'} SublimeCompatibility
 */

/**
 * Infer Sublime Text compatibility from release selectors.
 *
 * Returns null when release data is unavailable, such as for skeleton
 * tombstones.
 *
 * @param {Array<{sublime_text?: string}>} releases
 * @returns {SublimeCompatibility | null}
 */
export function computeSublimeCompatibility(releases) {
  if (releases.length === 0) {
    return null
  }

  const supportsModernSublime = releases.some((release) => {
    return parseSublimeTextMin(release.sublime_text) >= 3000
  })
  if (!supportsModernSublime) {
    return 'st2'
  }

  const doesNotSupportNewestSublime = releases.every((release) => {
    return parseSublimeTextMax(release.sublime_text) < 4000
  })
  if (doesNotSupportNewestSublime) {
    return 'st3'
  }

  return 'current'
}

/**
 * Convert a Sublime Text build selector into its starting build number.
 * Rules:
 * - Remove spaces.
 * - "*" -> 3000
 * - "<NNNN"   -> 0
 * - "<=NNNN"  -> 0
 * - ">NNNN"  -> NNNN + 1
 * - ">=NNNN" -> NNNN
 * - "NNNN-MMMM" -> NNNN (strip after '-')
 * - plain "NNNN" -> NNNN
 * If parsing fails, return 0.
 * @param {string} selector
 * @returns {number}
 */
export function parseSublimeTextMin(selector) {
  if (typeof selector !== 'string') {
    return 0
  }
  const s = selector.replace(/\s+/g, '')
  if (s === '' || s === '*') {
    return 3000
  }

  // range like 3092-4000 -> take left side
  const rangeIdx = s.indexOf('-')
  if (rangeIdx !== -1) {
    const left = s.slice(0, rangeIdx)
    const n = parseInt(left, 10)
    return Number.isFinite(n) ? n : 0
  }

  // comparators
  if (s.startsWith('<='))
    return 0
  if (s.startsWith('<'))
    return 0
  if (s.startsWith('>=')) {
    const n = parseInt(s.slice(2), 10)
    return Number.isFinite(n) ? n : 0
  }
  if (s.startsWith('>')) {
    const n = parseInt(s.slice(1), 10)
    return Number.isFinite(n) ? (n + 1) : 0
  }
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : 0
}

export function parseSublimeTextMax(selector) {
  if (typeof selector !== 'string') {
    return Infinity
  }
  const s = selector.replace(/\s+/g, '')
  if (s === '' || s === '*') {
    return Infinity
  }

  const rangeIdx = s.indexOf('-')
  if (rangeIdx !== -1) {
    const right = s.slice(rangeIdx + 1)
    const n = parseInt(right, 10)
    return Number.isFinite(n) ? n : Infinity
  }

  if (s.startsWith('<=')) {
    const n = parseInt(s.slice(2), 10)
    return Number.isFinite(n) ? n : Infinity
  }
  if (s.startsWith('<')) {
    const n = parseInt(s.slice(1), 10)
    return Number.isFinite(n) ? Math.max(0, n - 1) : Infinity
  }
  if (s.startsWith('>=')) {
    return Infinity
  }
  if (s.startsWith('>')) {
    return Infinity
  }
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : Infinity
}

/**
 * Find the last git commit hash.
 * Only executes in production builds to avoid overhead and issues when git is unavailable.
 */
export const gitHash = isProd ? execSync('git rev-parse --short HEAD').toString().trim() : 'deadbead'

// Mutable crawler artifacts need a version for this exact build, independently
// of the commit-based version used by source assets.
export const dataVersion = isProd ? Date.now().toString(36) : ''

function utcifyISODateString(dateStr) {
  return dateStr.replace(' ', 'T') + (dateStr.endsWith('Z') ? '' : 'Z')
}

// Convert a date string (assumed UTC like "YYYY-MM-DD HH:MM:SS")
// to an ISO week string "YYYY-Www" (e.g. 2025-09-02 -> "2025-W36").
export function isoWeekString(dateStr) {
  if (!dateStr) return null
  const tmp = new Date(utcifyISODateString(dateStr))
  // ISO week: shift to Thursday of current week
  const d = new Date(Date.UTC(tmp.getUTCFullYear(), tmp.getUTCMonth(), tmp.getUTCDate()))
  const day = d.getUTCDay() || 7 // Mon (=1)...Sun (=7)
  d.setUTCDate(d.getUTCDate() + 4 - day) // to Thursday
  const isoYear = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const week = Math.ceil(((d - yearStart) / (24 * 60 * 60 * 1000) + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

// Inline tests (Vitest)
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest

  describe('getReadmeUrl', () => {
    it('returns null when readme is missing', () => {
      expect(getReadmeUrl(null)).toBeNull()
    })

    it('maps GitHub raw URLs to blob URLs', () => {
      expect(
        getReadmeUrl('https://raw.githubusercontent.com/agrc/AmdButler/master/README.md'),
      ).toBe('https://github.com/agrc/AmdButler/blob/master/README.md')
    })

    it('maps GitHub refs/heads raw URLs to blob URLs', () => {
      expect(
        getReadmeUrl('https://raw.githubusercontent.com/agrc/AmdButler/refs/heads/main/README.md'),
      ).toBe('https://github.com/agrc/AmdButler/blob/main/README.md')
    })

    it('maps GitLab raw URLs to blob URLs', () => {
      expect(
        getReadmeUrl('https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/raw/master/README.md'),
      ).toBe('https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/blob/master/README.md')
    })

    it('maps Bitbucket raw URLs to src URLs', () => {
      expect(
        getReadmeUrl('https://bitbucket.org/JeisonJHA/sublime-delphi-language/raw/master/README.md'),
      ).toBe('https://bitbucket.org/JeisonJHA/sublime-delphi-language/src/master/README.md')
    })

    it('maps Codeberg raw URLs to src URLs (branch)', () => {
      expect(
        getReadmeUrl('https://codeberg.org/ISSOtm/sublime-Bison/raw/branch/master/README.md'),
      ).toBe('https://codeberg.org/ISSOtm/sublime-Bison/src/branch/master/README.md')
    })
  })

  describe('getSourceUrl', () => {
    it('returns null when source is missing', () => {
      expect(getSourceUrl(null)).toBeNull()
    })

    it('maps GitHub raw source URLs to editable blob URLs', () => {
      expect(
        getSourceUrl('https://raw.githubusercontent.com/example/channel/main/repository.json'),
      ).toBe('https://github.com/example/channel/blob/main/repository.json')
    })

    it('maps Package Control channel source to canonical sublimehq URL', () => {
      expect(
        getSourceUrl('https://raw.githubusercontent.com/wbond/package_control_channel/refs/heads/master/repository.json'),
      ).toBe('https://github.com/sublimehq/package_control_channel/blob/master/repository.json')
    })
  })

  describe('extractPackageName', () => {
    it('returns explicit name when present', () => {
      expect(
        extractPackageName({
          name: 'GitSavvy',
          details: 'https://github.com/timbrel/GitSavvy',
        }),
      ).toBe('GitSavvy')
    })

    it.each([
      ['https://github.com/timbrel/GitSavvy', 'GitSavvy'],
      ['https://github.com/timbrel/GitSavvy/tree/dev', 'GitSavvy'],
      ['https://github.com/timbrel/GitSavvy/releases/tag/2.50.0', 'GitSavvy'],
      ['https://gitlab.com/jiehong/sublime_jq', 'sublime_jq'],
      ['https://bitbucket.org/hmml/jsonlint', 'jsonlint'],
      ['https://codeberg.org/TobyGiacometti/SublimeDirectorySettings', 'SublimeDirectorySettings'],
    ])('derives name %s -> %s', (details, expected) => {
      expect(extractPackageName({ details })).toBe(expected)
    })

    it('returns null for invalid details URL', () => {
      expect(extractPackageName({ details: 'https://github.com/timbrel' })).toBeNull()
    })

    it('returns null when both name and details are missing', () => {
      expect(extractPackageName({})).toBeNull()
    })
  })

  describe('parseOwnerRepo', () => {
    it.each([
      ['https://github.com/timbrel/GitSavvy', ['timbrel', 'GitSavvy']],
      ['https://github.com/timbrel/GitSavvy/tree/dev', ['timbrel', 'GitSavvy']],
      ['https://gitlab.com/jiehong/sublime_jq', ['jiehong', 'sublime_jq']],
      ['https://bitbucket.org/hmml/jsonlint', ['hmml', 'jsonlint']],
      ['https://codeberg.org/TobyGiacometti/SublimeDirectorySettings', ['TobyGiacometti', 'SublimeDirectorySettings']],
    ])('parses %s', (url, expected) => {
      expect(parseOwnerRepo(url)).toEqual(expected)
    })

    it('throws for invalid *Hub URL', () => {
      expect(() => parseOwnerRepo('https://github.com/timbrel')).toThrow('Invalid *Hub repo URL')
    })
  })

  describe('utcifyISODateString', () => {
    it.each([
      ['2025-09-02 11:50:44', '2025-09-02T11:50:44Z'],
      ['2025-09-02T11:50:44', '2025-09-02T11:50:44Z'],
      ['2025-09-02T11:50:44Z', '2025-09-02T11:50:44Z'],

    ])('utcifyISODateString(%s) -> %s', (input, expected) => {
      expect(utcifyISODateString(input)).toBe(expected)
    })
  })

  describe('isoWeekString', () => {
    it.each([
      // User example: Tuesday in W36 of 2025
      ['2025-09-02 11:50:44', '2025-W36'],
      // Monday start and Sunday end of same week
      ['2025-09-01 00:00:00', '2025-W36'],
      ['2025-09-07 23:59:59', '2025-W36'],
      // Year boundary cases
      ['2018-12-31 12:00:00', '2019-W01'], // Mon belongs to 2019-W01
      ['2019-01-01 00:00:00', '2019-W01'], // Tue
      ['2020-01-01 00:00:00', '2020-W01'], // Wed
      ['2016-01-01 00:00:00', '2015-W53'], // Fri belongs to last week of 2015
      // Known anchors
      ['2014-12-29 00:00:00', '2015-W01'], // Mon of 2015-W01
      ['2016-01-04 00:00:00', '2016-W01'], // Mon of 2016-W01
    ])('isoWeekString(%s) -> %s', (input, expected) => {
      expect(isoWeekString(input)).toBe(expected)
    })
  })

  describe('computeSublimeCompatibility', () => {
    it('returns null when release data is unavailable', () => {
      expect(computeSublimeCompatibility([])).toBeNull()
    })

    it('detects ST2-only packages', () => {
      expect(computeSublimeCompatibility([
        { sublime_text: '<3000' },
        { sublime_text: '2000' },
      ])).toBe('st2')
    })

    it('detects ST3-only packages', () => {
      expect(computeSublimeCompatibility([
        { sublime_text: '3000-3999' },
        { sublime_text: '3000' },
      ])).toBe('st3')
    })

    it('detects packages compatible with current Sublime Text', () => {
      expect(computeSublimeCompatibility([
        { sublime_text: '*' },
      ])).toBe('current')
    })
  })

  describe('parseSublimeTextMin', () => {
    it.each([
      [null, 0],
      ['', 3000],
      ['*', 3000],
      ['  *  ', 3000],
      ['3092', 3092],
      ['3092 - 4000', 3092],
      ['3092-4000', 3092],
      ['<3092', 0],
      ['<=3092', 0],
      ['>3092', 3093],
      ['>=3092', 3092],
      [' >=  4075 ', 4075],
      ['>  4075', 4076],
      ['n/a', 0],
    ])('parseSublimeTextMin(%j) -> %j', (input, expected) => {
      expect(parseSublimeTextMin(input)).toBe(expected)
    })
  })

  describe('parseSublimeTextMax', () => {
    it.each([
      [null, Infinity],
      ['', Infinity],
      ['*', Infinity],
      ['  *  ', Infinity],
      ['3092', 3092],
      ['3092 - 4000', 4000],
      ['3092-4000', 4000],
      ['<3092', 3091],
      ['<=3092', 3092],
      ['>3092', Infinity],
      ['>=3092', Infinity],
      [' >=  4075 ', Infinity],
      ['>  4075', Infinity],
      ['n/a', Infinity],
    ])('parseSublimeTextMax(%j) -> %j', (input, expected) => {
      expect(parseSublimeTextMax(input)).toBe(expected)
    })
  })

  describe('prettifyPlatformLabels', () => {
    it.each([
      [['osx'], ['macOS']],
      [['linux'], ['Linux']],
      [['windows'], ['Windows']],
      [['osx-x64'], ['macOS-x64']],
      [['linux-x32', 'windows-x64'], ['Linux-x32', 'Windows-x64']],
      [['*'], ['any']],
    ])('prettifyPlatformLabels(%j) -> %j', (input, expected) => {
      expect(prettifyPlatformLabels(input)).toEqual(expected)
    })
  })

  describe('computePlatformStatement', () => {
    it.each([
      [[], ''],
      [['any'], ''],
      [['linux', 'windows', 'macos'], ''],

      [['macos'], 'Only for macOS'],
      [['windows'], 'Only for Windows'],
      [['linux'], 'Only for Linux'],

      [['macos', 'linux'], 'Not for Windows'],
      [['macos', 'windows'], 'Not for Linux'],
      [['linux', 'windows'], 'Not for macOS'],

      [['linux-x64', 'windows-x64', 'macos-x64'], 'Linux‑x64\u00A0/ Windows\u00A0/ macOS‑x64'],
      [['linux-arm64', 'linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64'], ''],

      [['linux-x32', 'linux-x64'], 'Linux‑x32\u00A0/ Linux‑x64'],
      [['linux-x32', 'linux-x64', 'windows'], 'Linux‑x32\u00A0/ Linux‑x64\u00A0/ Windows'],

      [['windows-x64'], 'Only for Windows'],
      [['windows-arm64'], 'Only on Windows‑arm64'],
      [['windows-arm64', 'windows-x64'], 'Only for Windows'],
      [['windows-x32', 'windows-x64'], 'Only for Windows'],
      [['macos-arm64', 'macos-x64'], 'Only for macOS'],
      [['linux-arm64', 'linux-x64'], 'Only for Linux'],
      [['macos-x64'], 'Only on macOS‑x64'],
      [['linux-x64'], 'Only on Linux‑x64'],
      [['linux-x32', 'windows-x32'], 'Linux‑x32\u00A0/ Windows‑x32'],
      [['linux-arm64'], 'Only on Linux‑arm64'],
    ])('computePlatformStatement(%j) -> %j', (input, expected) => {
      expect(computePlatformStatement(input)).toBe(expected)
    })
  })

  describe('computePlatformLabelsForSearch', () => {
    it('dedupes platform tokens', () => {
      const releases = [
        { platforms: ['linux', 'windows'] },
        { platforms: ['windows'] },
      ]
      expect(computePlatformLabelsForSearch(releases).sort()).toEqual(['linux', 'windows'])
    })

    it('normalizes osx tokens to macos', () => {
      const releases = [
        { platforms: ['osx'] },
        { platforms: ['osx-x64'] },
      ]
      expect(computePlatformLabelsForSearch(releases).sort()).toEqual(['macos', 'macos-x64'])
    })

    it('collapses full OS coverage to any', () => {
      const releases = [
        { platforms: ['linux'] },
        { platforms: ['windows'] },
        { platforms: ['osx'] },
      ]
      expect(computePlatformLabelsForSearch(releases)).toEqual(['any'])
    })

    it('collapses explicit any tokens', () => {
      const releases = [
        { platforms: ['*'] },
        { platforms: ['linux'] },
      ]
      expect(computePlatformLabelsForSearch(releases)).toEqual(['any'])
    })
  })

  describe('sortFeaturedLabelsFirst', () => {
    const featured = ['language syntax', 'snippets', 'linting', 'auto-complete', 'color scheme', 'theme']
    const rank = new Map(featured.map((label, index) => [label, index]))

    it('moves featured labels to the front using featured list order', () => {
      const labels = ['zzz', 'theme', 'aaa', 'snippets', 'linting', 'bbb', 'language syntax']
      expect(sortFeaturedLabelsFirst(labels, rank)).toEqual([
        'language syntax',
        'snippets',
        'linting',
        'theme',
        'zzz',
        'aaa',
        'bbb',
      ])
    })

    it('keeps non-featured labels in original relative order', () => {
      const labels = ['one', 'snippets', 'two', 'language syntax', 'three', 'theme', 'four']
      expect(sortFeaturedLabelsFirst(labels, rank)).toEqual([
        'language syntax',
        'snippets',
        'theme',
        'one',
        'two',
        'three',
        'four',
      ])
    })
  })

  describe('simplifyPackageLabels', () => {
    it('normalizes labels to the most frequent casing', () => {
      const packages = simplifyPackageLabels([
        { name: 'first', labels: ['c'] },
        { name: 'second', labels: ['C'] },
        { name: 'third', labels: ['C'] },
      ])

      expect(packages).toEqual([
        {
          name: 'first',
          labels: ['C'],
          normalized_labels: [{ from: 'c', to: 'C' }],
        },
        { name: 'second', labels: ['C'] },
        { name: 'third', labels: ['C'] },
      ])
    })

    it('normalizes configured aliases to their preferred spelling', () => {
      const packages = simplifyPackageLabels([
        { name: 'first', labels: ['autocomplete', 'colorscheme'] },
        { name: 'second', labels: ['auto complete', 'color scheme'] },
      ])

      expect(packages).toEqual([
        {
          name: 'first',
          labels: ['auto-complete', 'color scheme'],
          normalized_labels: [
            { from: 'autocomplete', to: 'auto-complete' },
            { from: 'colorscheme', to: 'color scheme' },
          ],
        },
        {
          name: 'second',
          labels: ['auto-complete', 'color scheme'],
          normalized_labels: [{ from: 'auto complete', to: 'auto-complete' }],
        },
      ])
    })

    it('deduplicates labels within a package after normalization', () => {
      const packages = simplifyPackageLabels([
        { name: 'codeium', labels: ['auto-complete', 'autocomplete', 'snippets'] },
      ])

      expect(packages).toEqual([
        {
          name: 'codeium',
          labels: ['auto-complete', 'snippets'],
          normalized_labels: [{ from: 'autocomplete', to: 'auto-complete' }],
        },
      ])
    })
  })

  describe('collectLabels', () => {
    it('counts normalized labels for the labels page', () => {
      const packages = [
        { labels: ['c++', 'syntax'] },
        { labels: ['python', 'syntax'] },
        { labels: ['syntax'] },
      ]

      expect(collectLabels(packages)).toEqual([
        { key: 'c++', count: 1 },
        { key: 'python', count: 1 },
        { key: 'syntax', count: 3 },
      ])
    })

    it('counts each label at most once per package', () => {
      const packages = [
        { labels: ['syntax', 'syntax'] },
        { labels: ['syntax'] },
      ]

      expect(collectLabels(packages)).toEqual([
        { key: 'syntax', count: 2 },
      ])
    })
  })

  describe('weightReleases', () => {
    it('sorts internally by build then date before splitting', () => {
      const releases = [
        { version: '1.8', date: '2024-02-01T00:00:00Z', sublime_text: '4100', platforms: ['windows'] },
        { version: '1.10', date: '2024-04-01T00:00:00Z', sublime_text: '4137', platforms: ['windows'] },
        { version: '1.9', date: '2024-03-01T00:00:00Z', sublime_text: '4137', platforms: ['windows'] },
      ]
      const { mainReleases, otherReleases } = weightReleases(releases)
      expect(mainReleases.map(r => r.version)).toEqual(['1.10', '1.8'])
      expect(otherReleases.map(r => r.version)).toEqual(['1.9'])
    })

    it('keeps the prerelease and next stable for the same key', () => {
      const releases = [
        { version: '5.0.0-beta.1', sublime_text: '*', platforms: ['windows'] },
        { version: '4.2.0', sublime_text: '*', platforms: ['windows'] },
        { version: '4.1.0', sublime_text: '*', platforms: ['windows'] },
      ]
      const { mainReleases, otherReleases } = weightReleases(releases)
      expect(mainReleases.map(r => r.version)).toEqual(['5.0.0-beta.1', '4.2.0'])
      expect(otherReleases.map(r => r.version)).toEqual(['4.1.0'])
    })

    it('keeps only the first stable when the newest is stable', () => {
      const releases = [
        { version: '5.0.0', sublime_text: '*', platforms: ['linux', 'windows'] },
        { version: '5.0.0-beta.1', sublime_text: '*', platforms: ['windows', 'linux'] },
      ]
      const { mainReleases, otherReleases } = weightReleases(releases)
      expect(mainReleases.map(r => r.version)).toEqual(['5.0.0'])
      expect(otherReleases.map(r => r.version)).toEqual(['5.0.0-beta.1'])
    })

    it('ensures platform order is irrelevant', () => {
      const releases = [
        { version: '4.2.0', sublime_text: '*', platforms: ['linux', 'windows'] },
        { version: '4.1.0', sublime_text: '*', platforms: ['windows', 'linux'] },
      ]
      const { mainReleases, otherReleases } = weightReleases(releases)
      expect(mainReleases.map(r => r.version)).toEqual(['4.2.0'])
      expect(otherReleases.map(r => r.version)).toEqual(['4.1.0'])
    })
  })
}
