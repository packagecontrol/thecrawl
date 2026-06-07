import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  __test__,
  dimensions,
  isoWeekIndex,
  releaseWeekModel,
  renderInstallChart,
} from './eleventy.install-chart.mjs'
import * as util from './eleventy.util.mjs'

const fixturePackages = [
  'GitLink',
  'SSH Config',
  'Piranha',
  'GitHub Theme',
  'GitSavvy',
  'SublimeLinter',
  'LSP',
]

describe('renderInstallChart', () => {
  it.each(fixturePackages)('matches the captured Nunjucks chart for %s', (name) => {
    const pkg = chartPackageForName(name)
    const expected = readChartFixture(name)
    const actual = renderInstallChart(pkg)

    expect(normalizeChartHtml(actual)).toBe(normalizeChartHtml(expected))
  })

  it('does not render completely empty charts', () => {
    expect(renderInstallChart({
      allReleases: [],
      weekly_dates: ['2026-W17'],
      weekly_installs: [],
      weekly_removals: [],
      weekly_upgrades: [],
    })).toBe('')
  })
})

describe('everyOther', () => {
  it.each([
    [[[0, 1, 2, 3, 4], 0], [0, 2, 4]],
    [[[0, 1, 2, 3, 4], 1], [1, 3]],
    [[[0, 1, 2, 3, 4], 2], [0, 2, 4]], // start cycles every 2
    [[[0, 1, 2, 3, 4], -1], [1, 3]], // negative start handled
  ])('everyOther(%j) -> %j', (args, expected) => {
    expect(__test__.everyOther(...args)).toStrictEqual(expected)
  })

  it('passes through non-arrays', () => {
    expect(__test__.everyOther('not-array')).toBe('not-array')
    expect(__test__.everyOther(null)).toBe(null)
    expect(__test__.everyOther(undefined)).toBe(undefined)
  })
})

describe('axisFor', () => {
  it.each([
    [[0], 5, [0, 1, 2, 3, 4, 5]],
    [[25], 5, [0, 5, 10, 15, 20, 25]],
  ])('axisFor(%j, %d).steps -> %s', (arr, target, expected) => {
    expect(__test__.axisFor(arr, target).steps).toStrictEqual(expected)
  })

  it.each([
    [[25], 5, 100, 0, 0],
    [[25], 5, 100, 5, 20],
    [[25], 5, 100, 10, 40],
    [[25], 5, 100, 15, 60],
    [[25], 5, 100, 20, 80],
    [[25], 5, 100, 25, 100],
  ])('axisFor(%j, %d, %d).to_px(%d) -> %s', (arr, target, height, val, expected) => {
    expect(__test__.axisFor(arr, target, height).to_px(val)).toBe(expected)
  })

  it.each([
    [[25], 5, 100, 0, 100],
    [[25], 5, 100, 5, 80],
    [[25], 5, 100, 10, 60],
    [[25], 5, 100, 15, 40],
    [[25], 5, 100, 20, 20],
    [[25], 5, 100, 25, 0],
  ])('axisFor(%j, %d, %d).y_for(%d) -> %s', (arr, target, height, val, expected) => {
    expect(__test__.axisFor(arr, target, height).y_for(val)).toBe(expected)
  })
})

describe('computeStep', () => {
  it.each([
    [[0, 1, 2, 3], 5, 1],
    [[0], 5, 1],
    [[1], 5, 1],
    [[2], 5, 1],
    [[3], 5, 1],
    [[4], 5, 1],
    [[5], 5, 1],
    [[6], 5, 2],
    [[10], 5, 2],
    [[11], 5, 5],
    [[25], 5, 5],
    [[26], 5, 10],
    [[50], 5, 10],
    [[51], 5, 20],
    [[100], 5, 20],
    [[101], 5, 25],
    [[125], 5, 25],
    [[126], 5, 50],
    [[250], 5, 50],
    [[251], 5, 100],
    [[500], 5, 100],
    [[501], 5, 200],
    [[1000], 5, 200],
    [[1001], 5, 250],
    [[1250], 5, 250],
    [[1251], 5, 500],
    [[2500], 5, 500],
    [[2501], 5, 1000],
    [[37], 5, 10],
    [[413], 5, 100],
    [[9876], 5, 2000],
    [[100], 4, 25],
    [[100], 3, 50],
    [[1000], 5, 200],
  ])('computeStep(%j, %d) = %d', (arr, target, expected) => {
    expect(__test__.computeStep(arr, target)).toBe(expected)
  })
})

describe('magnitude', () => {
  it.each([
    [0, 1],
    [1, 1],
    [9, 1],
    [10, 10],
    [11, 10],
    [99, 10],
    [100, 100],
    [123456, 100000],
  ])('magnitude(%d) = %d', (n, expected) => {
    expect(__test__.magnitude(n)).toBe(expected)
  })
})

describe('mondayOfIsoWeek', () => {
  it.each([
    ['2025-W01', '2024-12-30'],
    ['2025-W36', '2025-09-01'],
    ['2018-W01', '2018-01-01'],
    ['2019-W01', '2018-12-31'],
    ['2020-W01', '2019-12-30'],
    ['2015-W01', '2014-12-29'],
    ['2016-W01', '2016-01-04'],
    ['2022-W01', '2022-01-03'],
    ['2017-W01', '2017-01-02'],
  ])('mondayOfIsoWeek(%s) -> %s', (iso, expectedIso) => {
    expect(__test__.mondayOfIsoWeek(iso).toISOString().slice(0, 10)).toBe(expectedIso)
  })
})

describe('dayOffsetOfMonthChange', () => {
  it.each([
    ['2025-09-01', 0],
    ['2025-06-30', 1],
    ['2024-12-30', 2],
    ['2024-07-29', 3],
    ['2024-10-28', 4],
    ['2025-02-24', 5],
    ['2024-08-26', 6],
    ['2025-09-08', -1],
  ])('offset for %s -> %d', (ymd, expected) => {
    const monday = new Date(ymd + 'T00:00:00Z')
    expect(monday.getUTCDay()).toBe(1)
    expect(__test__.dayOffsetOfMonthChange(monday)).toBe(expected)
  })
})

describe('isoWeekIndex', () => {
  it('finds a direct week index', () => {
    expect(isoWeekIndex(['2026-W17', '2026-W16'], '2026-04-22T18:02:46Z')).toBe(0)
    expect(isoWeekIndex(['2026-W17', '2026-W16'], '2026-04-15T18:02:46Z')).toBe(1)
  })

  it('computes older week indexes outside the provided date list', () => {
    expect(isoWeekIndex(['2026-W17'], '2026-04-15T18:02:46Z')).toBe(1)
  })

  it('returns null for newer or invalid dates', () => {
    expect(isoWeekIndex(['2026-W17'], '2026-04-29T18:02:46Z')).toBe(null)
    expect(isoWeekIndex(['2026-W17'], 'not-a-date')).toBe(null)
  })
})

describe('releaseWeekModel', () => {
  it('sorts and deduplicates versions in each release week', () => {
    const releases = [
      { date: '2026-04-22T18:02:46Z', sublime_text: '>=4204', version: '6.1.0' },
      { date: '2026-04-22T18:02:27Z', sublime_text: '4107 - 4203', version: '5.1.0' },
      { date: '2026-04-22T15:17:35Z', sublime_text: '>=4204', version: '6.0.0' },
      { date: '2026-04-20T00:27:09Z', sublime_text: '4107 - 4203', version: '5.0.3' },
      { date: '2026-04-20T00:27:09Z', sublime_text: '>=4204', version: '5.0.3' },
    ]

    expect(releaseWeekModel(releases, ['2026-W17'], 1)).toStrictEqual([
      {
        week_idx: 0,
        versions: ['6.1.0', '6.0.0', '5.0.3', '5.1.0'],
      },
    ])
  })
})

describe('dimensions', () => {
  it('uses bar_w_gap except for last slice', () => {
    const base = { bar_w: 12, gap: 1, top: 0, bottom: 0, left: 0, right: 0, chart_h: 100 }
    const totalCount = 3
    const d = dimensions(base, totalCount)
    expect(d.bar_w_gap).toBe(13)
    expect(d.slice_width_at(0)).toBe(13)
    expect(d.slice_width_at(1)).toBe(13)
    expect(d.slice_width_at(2)).toBe(12)
  })

  it('handles single-slice charts', () => {
    const base = { bar_w: 10, gap: 5, top: 0, bottom: 0, left: 0, right: 0, chart_h: 50 }
    const d = dimensions(base, 1)
    expect(d.bar_w_gap).toBe(15)
    expect(d.slice_width_at(0)).toBe(10)
  })
})

function chartPackageForName(name) {
  const workspace = JSON.parse(fs.readFileSync('workspace.json', 'utf8'))
  const stats = JSON.parse(fs.readFileSync('stats.json', 'utf8'))
  const pkg = Object.values(workspace.packages).find(candidate => candidate.name === name)
  if (!pkg) {
    throw new Error(`Missing package ${name}`)
  }

  const weeklyDates = stats.__weekly_dates
  const weeklyInstalls = stats[pkg.name]?.installs?.weekly ?? []
  const weeklyRemovals = stats[pkg.name]?.removals?.weekly ?? []
  const weeklyUpgrades = stats[pkg.name]?.upgrades?.weekly ?? []

  let end = undefined
  if (pkg.first_seen && weeklyDates) {
    const iso = util.isoWeekString(pkg.first_seen)
    const idx = weeklyDates.indexOf(iso)
    if (idx >= 0) {
      end = idx + 1
    }
  }

  return {
    ...pkg,
    installed: stats[pkg.name]?.installs?.totals ?? 0,
    weekly_dates: weeklyDates,
    weekly_installs: weeklyInstalls.slice(0, end),
    weekly_removals: weeklyRemovals.slice(0, end),
    weekly_upgrades: weeklyUpgrades.slice(0, end),
    allReleases: allReleasesFor(pkg),
  }
}

function allReleasesFor(pkg) {
  return [...(pkg.releases ?? [])].sort((a, b) => {
    const dateA = new Date(a.date ?? '1970-01-01 00:00:00')
    const dateB = new Date(b.date ?? '1970-01-01 00:00:00')
    if (dateA.getTime() !== dateB.getTime()) {
      return dateB - dateA
    }
    const minA = util.parseSublimeTextMin(a.sublime_text)
    const minB = util.parseSublimeTextMin(b.sublime_text)
    return minB - minA
  })
}

function readChartFixture(name) {
  return fs.readFileSync(path.join('test', 'fixtures', 'install-chart', `${name}.html`), 'utf8')
}

function normalizeChartHtml(html) {
  return html
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim()
}
