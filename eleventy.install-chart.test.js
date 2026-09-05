import { describe, expect, it } from 'vitest'
import {
  __test__,
  dimensions,
  isoWeekIndex,
  releasePointModel,
  releaseWeekModel,
  renderInstallChart,
  upgradePointModel,
} from './eleventy.install-chart.mjs'

describe('renderInstallChart', () => {
  it('does not render completely empty charts', () => {
    expect(renderInstallChart({
      allReleases: [],
      weekly_dates: ['2026-W17'],
      weekly_installs: [],
      weekly_removals: [],
      weekly_upgrades: [],
    })).toBe('')
  })

  it('includes the running week in the visible lifetime total', () => {
    const output = renderInstallChart({
      first_seen: '2026-04-08T12:00:00Z',
      weekly_dates: ['2026-W17', '2026-W16', '2026-W15'],
      weekly_installs: [100, 2, 3],
      weekly_removals: [0, 0, 0],
      weekly_upgrades: [0, 0, 0],
    })

    expect(output).toContain('105 in total')
  })

  it('labels the visible sum as the weeks shown for older packages', () => {
    const output = renderInstallChart({
      first_seen: '2020-01-01T00:00:00Z',
      weekly_dates: ['2026-W17', '2026-W16', '2026-W15'],
      weekly_installs: [1, 2, 3],
      weekly_removals: [0, 0, 0],
      weekly_upgrades: [0, 0, 0],
      installs_total: 999,
    })

    expect(output).toContain('6 in the 3 weeks shown')
    expect(output).not.toContain('999')
  })

  it('clips upgrades only at the right axis and omits weekly dots', () => {
    const output = renderInstallChart({
      allReleases: [
        { date: '2026-04-22T18:02:46Z', version: '1.0.0' },
      ],
      weekly_dates: Array(54).fill('2026-W17'),
      weekly_installs: Array(54).fill(1),
      weekly_removals: Array(54).fill(0),
      weekly_upgrades: [...Array(53).fill(1), 5],
    })

    expect(output).toContain('<svg viewBox="0 0 798 216"')
    expect(output).toContain('<g clip-path="url(#clip-upgrades)">')
    expect(output).toContain('<rect x="-50" y="-14" width="738" height="216" class="">')
    expect(output).toContain('695 0" class="upgrades-line"')
    expect(output).not.toContain('upgrades-point')
    expect(output).toContain('class="release-point"')
    expect(output).toContain('53 in the 53 weeks shown')
  })

  it('labels recent release dots with weekly and daily upgrades', () => {
    const output = renderInstallChart({
      allReleases: [
        { date: '2026-09-04T18:02:46Z', version: '6.3.0' },
      ],
      daily_dates: descendingDates('2026-09-04', 7),
      daily_upgrades: [30, 29, 28, 27, 26, 25, 24],
      weekly_dates: ['2026-W36'],
      weekly_installs: [1],
      weekly_removals: [0],
      weekly_upgrades: [179],
    })

    expect(output).toContain('2026-09-04 | upgrades: 179 | 30 on that day')
    expect(output).not.toContain('7-day rate')
  })

  it('keeps zero-to-zero upgrade curves flat on the x-axis', () => {
    const output = renderInstallChart({
      weekly_dates: Array(4).fill('2026-W17'),
      weekly_installs: Array(4).fill(1),
      weekly_removals: Array(4).fill(0),
      weekly_upgrades: [1, 0, 0, 1],
    })

    expect(output).toContain(
      'C 21.166666666666668 160 27.666666666666668 160 32 160',
    )
  })

  it('dampens upgrade curves to the adjacent sample range', () => {
    const output = renderInstallChart({
      weekly_dates: Array(4).fill('2026-W17'),
      weekly_installs: Array(4).fill(1),
      weekly_removals: Array(4).fill(0),
      weekly_upgrades: [2, 1, 1, 2],
    })

    expect(output).toContain(
      'C 21.166666666666668 128 27.666666666666668 128 32 128',
    )
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

describe('upgradePointModel', () => {
  it('uses trailing seven-day upgrade rates for the latest 28 days', () => {
    const dailyDates = descendingDates('2026-09-04', 34)
    const dailyUpgrades = Array.from({ length: 34 }, (_, i) => i + 1)
    const weeklyUpgrades = [100, 90, 80, 70, 60, 50]
    const dim = { bar_w: 12, bar_w_gap: 13 }

    const model = upgradePointModel(
      weeklyUpgrades,
      ['2026-W36'],
      dailyUpgrades,
      dailyDates,
      dim,
    )

    expect(model.usesDaily).toBe(true)
    expect(model.dailyPoints).toHaveLength(28)
    expect(model.dailyPoints[0]).toMatchObject({ date: '2026-09-04', rawValue: 1, value: 28 })
    expect(model.dailyPoints[0].x).toBeCloseTo(13 * 2.5 / 7)
    expect(model.dailyPoints[27]).toMatchObject({ date: '2026-08-08', rawValue: 28, value: 217 })
    expect(model.points.slice(28).map(point => point.week_idx)).toEqual([4, 5])
  })

  it('omits daily points without a complete seven-day window', () => {
    const model = upgradePointModel(
      [100, 90, 80, 70, 60],
      ['2026-W36'],
      Array.from({ length: 30 }, (_, i) => i + 1),
      descendingDates('2026-09-04', 30),
      { bar_w: 12, bar_w_gap: 13 },
    )

    expect(model.dailyPoints).toHaveLength(24)
    expect(model.dailyPoints[23].value).toBe(189)
  })

  it('does not multiply isolated daily spikes', () => {
    const model = upgradePointModel(
      [1000, 1000, 1000, 1000, 1000],
      ['2026-W36'],
      [1000, ...Array(29).fill(0)],
      descendingDates('2026-09-04', 30),
      { bar_w: 12, bar_w_gap: 13 },
    )

    expect(Math.max(...model.dailyPoints.map(point => point.value))).toBe(1000)
  })

  it('does not plot daily upgrades from before the package existed', () => {
    const model = upgradePointModel(
      [100, 90, 80],
      ['2026-W36'],
      Array.from({ length: 10 }, (_, i) => i + 1),
      descendingDates('2026-09-04', 10),
      { bar_w: 12, bar_w_gap: 13 },
      '2026-09-02T18:00:00Z',
    )

    expect(model.dailyPoints.map(point => point.date)).toEqual([
      '2026-09-04',
      '2026-09-03',
      '2026-09-02',
    ])
  })

  it('retains the weekly series when daily data is unavailable', () => {
    const model = upgradePointModel(
      [3, 2, 1],
      ['2026-W36'],
      [],
      [],
      { bar_w: 12, bar_w_gap: 13 },
    )

    expect(model.usesDaily).toBe(false)
    expect(model.points.map(point => point.value)).toEqual([3, 2, 1])
  })
})

describe('releasePointModel', () => {
  it('positions recent releases on their daily upgrade samples', () => {
    const dim = { bar_w: 12, bar_w_gap: 13 }
    const dailyPoints = upgradePointModel(
      [10, 20, 30],
      ['2026-W36'],
      [2, 3, 4, 5, 6, 7, 8, 9],
      descendingDates('2026-09-04', 8),
      dim,
    ).dailyPoints
    const releases = [
      { date: '2026-09-04T18:02:46Z', version: '2.0.0' },
      { date: '2026-09-03T08:00:00Z', version: '1.1.0' },
      { date: '2026-09-03T07:00:00Z', version: '1.0.0' },
    ]

    const points = releasePointModel(releases, ['2026-W36'], [10, 20, 30], dailyPoints, 53, dim)

    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({
      date: '2026-09-04',
      dailyValue: 2,
      period: 'daily',
      rawValue: 10,
      value: 35,
      versions: ['2.0.0'],
      week_idx: 0,
    })
    expect(points[0].x).toBe(dailyPoints[0].x)
    expect(points[1].versions).toEqual(['1.1.0', '1.0.0'])
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

function descendingDates(latest, count) {
  const date = new Date(`${latest}T00:00:00Z`)
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(date)
    day.setUTCDate(day.getUTCDate() - i)
    return day.toISOString().slice(0, 10)
  })
}

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
