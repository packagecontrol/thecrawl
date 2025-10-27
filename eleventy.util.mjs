import { execSync } from 'child_process'

const isProd = process.env.NODE_ENV === 'production' || process.env.ELEVENTY_ENV === 'production'

/**
 * Rename osx -> macos, * -> any
 */
export function cleanPlatforms(platforms) {
  return platforms
    .map(platform => platform === 'osx' ? 'macos' : platform)
    .map(platform => platform === '*' ? 'any' : platform)
}

/**
 * Deduplicate supported platform across releases.
 */
export function dedupePlatforms(releases) {
  const all = releases.flatMap(release => release.platforms)
  const unique = Array.from(new Set(all))
  // when a package actually supports all platforms (across multiple releases)
  if (unique.includes('linux') && unique.includes('windows') && unique.includes('macos')) {
    return ['any']
  }

  return unique
}

/**
 * Build the platform variant dataset over all libraries.
 * Input: array of libraries, each with releases[].platforms
 * Output: { windows: Set<string>, linux: Set<string>, osx: Set<string> }
 */
export function collectPlatformDataset(libraries) {
  const variantsByOs = {}
  for (const lib of libraries || []) {
    for (const rel of lib.releases || []) {
      for (const p of rel.platforms || []) {
        const m = /^(.+?)-(.+)$/i.exec(p)
        if (m) {
          const os = m[1].toLowerCase()
          const label = m[2].toLowerCase()
          if (!variantsByOs[os]) variantsByOs[os] = new Set()
          variantsByOs[os].add(label)
        }
      }
    }
  }
  return variantsByOs
}

/**
 * Simplify a library's platform list using the global dataset.
 * - If the library contains all known variants for an OS, collapse to base token (windows/linux/osx).
 * - If, after collapsing, it contains all three base tokens, return [] to hide labels.
 */
export function simplifyPlatforms(dataset, platforms) {
  const hasAll = (libSet, datasetSet) => {
    for (const v of datasetSet)
      if (!libSet.has(v))
        return false
    return true
  }

  const platformVariants = {}
  for (const p of platforms) {
    const m = /^(.+?)-(.+)$/i.exec(p)
    if (m) {
      const os = m[1].toLowerCase()
      const variant = m[2].toLowerCase()
      if (!platformVariants[os]) platformVariants[os] = new Set()
      platformVariants[os].add(variant)
    }
  }

  let result = new Set()
  for (const [os, variants] of Object.entries(platformVariants)) {
    if (hasAll(variants, dataset[os]))
      result.add(os)
    else
      variants.forEach(variant => result.add(`${os}-${variant}`))
  }

  if (['windows', 'linux', 'osx'].every(os => result.has(os))) {
    return []
  }

  return Array.from(result)
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
 * Convert links for the raw readme data to one for the file blob.
 */
export function getReadmeUrl(readme) {
  if (typeof readme !== 'string') {
    return null
  }

  // https://raw.githubusercontent.com/relikd/CUE-Sheet_sublime/main/README.md
  // => https://github.com/relikd/CUE-Sheet_sublime/blob/main/README.md
  //
  // https://gitlab.com/patopest/Sublime-Text-Cuelang-Syntax/-/raw/master/README.md
  // => https://gitlab.com/patopest/sublime-text-cuelang-syntax/-/blob/master/README.md
  //
  // https://bitbucket.org/JeisonJHA/sublime-delphi-language/raw/master/README.md
  // => https://bitbucket.org/JeisonJHA/sublime-delphi-language/src/master/README.md
  //
  // https://codeberg.org/ISSOtm/sublime-Bison/raw/branch/master/README.md
  // => https://codeberg.org/ISSOtm/sublime-Bison/src/branch/master/README.md

  return readme.replace( // GitHub raw to blob
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

/**
 * Find the last git commit hash.
 * Only executes in production builds to avoid overhead and issues when git is unavailable.
 */
export const gitHash = isProd ? execSync('git rev-parse --short HEAD').toString().trim() : 'deadbead'

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

  describe('collectPlatformDataset + simplifyPlatforms (libraries)', () => {
    const libraries = [
      {
        releases: [
          { platforms: ['windows-x32', 'windows-x64'] },
          { platforms: ['linux-x32'] },
        ],
      },
      {
        releases: [
          { platforms: ['linux-x64'] },
          { platforms: ['osx-x64'] },
        ],
      },
    ]

    it('collects global variant sets per OS', () => {
      const ds = collectPlatformDataset(libraries)
      expect(Array.from(ds.windows).sort()).toEqual(['x32', 'x64'])
      expect(Array.from(ds.linux).sort()).toEqual(['x32', 'x64'])
      expect(Array.from(ds.osx).sort()).toEqual(['x64'])
    })

    it('collapses to base OS only when all variants are present for that OS', () => {
      const ds = collectPlatformDataset(libraries)

      // Has both windows variants -> collapse to 'windows'
      expect(simplifyPlatforms(ds, ['windows-x32', 'windows-x64'])).toEqual(['windows'])

      // Missing one windows variant -> do not collapse
      expect(simplifyPlatforms(ds, ['windows-x64'])).toEqual(['windows-x64'])

      // Linux has x32 and x64 in dataset; this lib has both -> collapse
      expect(simplifyPlatforms(ds, ['linux-x32', 'linux-x64'])).toEqual(['linux'])

      // OSX dataset has only x64; having x64 means "all known" -> collapse
      expect(simplifyPlatforms(ds, ['osx-x64'])).toEqual(['osx'])
    })

    it('hides labels when all three base OS tokens are present', () => {
      const ds = collectPlatformDataset(libraries)
      expect(simplifyPlatforms(ds, ['windows-x32', 'windows-x64', 'linux-x32', 'linux-x64', 'osx-x64']))
        .toEqual([])
      expect(simplifyPlatforms(ds, ['windows', 'linux', 'osx'])).toEqual([])
    })
  })
}
