import { execSync } from 'child_process'

// rename macos and remove */any
export function cleanPlatforms(platforms) {
  return platforms
    .filter(platform => platform !== '*')
    .map(platform => platform === 'osx' ? 'macos' : platform)
}

// author can be string or array, convert to all arrays
export function cleanAuthors(author) {
  if (typeof author === 'string') {
    return [author]
  }
  return author
}

export function getReadmeUrl(readme) {
  if (typeof readme_url !== 'string') {
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

  return readme.replace( // GitHub raw to blob
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
    'https://github.com/$1/$2/blob/$3/$4',
  ).replace( // GitLab raw to blob
    /^https:\/\/gitlab\.com\/([^/]+)\/([^/]+)\/-\/raw\/([^/]+)\/(.+)$/,
    'https://gitlab.com/$1/$2/-/blob/$3/$4',
  ).replace( // Bitbucket raw to src
    /^https:\/\/bitbucket\.org\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
    'https://bitbucket.org/$1/$2/src/$3/$4',
  )
}

export const gitHash = execSync('git rev-parse --short HEAD').toString().trim()

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
}
