import { describe, expect, it } from 'vitest'
import {
  createDirectionalNavigationOrigin,
  createNotesMatcher,
  findDirectionalCorridorTarget,
  findNextNotesMatchIndex,
  MIN_NOTES_SEARCH_CHARS,
  tokenizeSearchText,
} from './status-search.js'

describe('createNotesMatcher', () => {
  it('stays inactive below the minimum query length', () => {
    expect(MIN_NOTES_SEARCH_CHARS).toBe(2)
    expect(createNotesMatcher('')).toBeNull()
    expect(createNotesMatcher(' a ')).toBeNull()
  })

  it('matches case-insensitively from the start of a token', () => {
    const matcher = createNotesMatcher('stat')

    expect(matcher('Status check completed.')).toBe(true)
    expect(matcher('The latest status is healthy.')).toBe(true)
    expect(matcher('A persistent record was saved.')).toBe(false)
  })

  it('matches terms inside kebab, snake, and camel case identifiers', () => {
    const matcher = createNotesMatcher('style')

    expect(matcher('Updated this-style package.')).toBe(true)
    expect(matcher('Updated ThatStyle package.')).toBe(true)
    expect(matcher('Updated another_style package.')).toBe(true)
    expect(matcher('Updated lifestyle package.')).toBe(false)
  })

  it('requires every query term to match', () => {
    const matcher = createNotesMatcher('package fail')

    expect(matcher('Two packages are currently failing.')).toBe(true)
    expect(matcher('Two packages were updated.')).toBe(false)
  })
})

describe('findNextNotesMatchIndex', () => {
  const entries = [
    { notes: 'A matching run' },
    { notes: 'Nothing relevant' },
    { notes: 'Another matching run' },
    {},
    { notes: 'The last matching run' },
  ]
  const matcher = createNotesMatcher('match')

  it('skips non-matches in either direction', () => {
    expect(findNextNotesMatchIndex(entries, 0, 1, matcher)).toBe(2)
    expect(findNextNotesMatchIndex(entries, 4, -1, matcher)).toBe(2)
  })

  it('can enter the matches from a non-matching entry', () => {
    expect(findNextNotesMatchIndex(entries, 1, -1, matcher)).toBe(0)
    expect(findNextNotesMatchIndex(entries, 1, 1, matcher)).toBe(2)
  })

  it('stops instead of leaving the matching results', () => {
    expect(findNextNotesMatchIndex(entries, 0, -1, matcher)).toBe(-1)
    expect(findNextNotesMatchIndex(entries, 4, 1, matcher)).toBe(-1)
  })
})

describe('findDirectionalCorridorTarget', () => {
  const origin = { id: 'origin', x: 0, y: 0 }

  it('uses a fixed horizontal corridor', () => {
    const points = [
      { id: 'adjacent-day-outside', x: -10, y: 11 },
      { id: 'aligned-farther-day', x: -20, y: 0 },
      { id: 'opposite', x: 5, y: 0 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      origin,
      { x: -1, y: 0 },
      10,
    )).toEqual({
      point: points[1],
      warped: false,
    })
  })

  it('chooses the nearest forward result within one corridor width', () => {
    const points = [
      { id: 'far', x: 30, y: 0 },
      { id: 'near', x: 10, y: 8 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      origin,
      { x: 1, y: 0 },
      10,
    )?.point.id).toBe('near')
  })

  it('does not widen for a result outside the corridor', () => {
    const points = [{ id: 'outside', x: 10, y: 25 }]

    expect(findDirectionalCorridorTarget(
      points,
      origin,
      { x: 1, y: 0 },
      10,
    )).toBeNull()
  })

  it('warps to the opposite edge when no forward result remains', () => {
    const current = { id: 'right-edge', x: 30, y: 0 }
    const points = [
      { id: 'middle', x: 10, y: 0 },
      { id: 'left-edge', x: 0, y: 5 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      current,
      { x: 1, y: 0 },
      10,
    )).toEqual({ point: points[1], warped: true })
  })

  it('applies the same corridor search vertically', () => {
    const points = [
      { id: 'near-time-outside-days', x: 11, y: 10 },
      { id: 'later-time-inside-days', x: 0, y: 20 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      origin,
      { x: 0, y: 1 },
      10,
    )?.point.id).toBe('later-time-inside-days')
  })

  it('treats both adjacent day centers as the same vertical corridor', () => {
    const dayWidth = 1184 / 30
    const current = { id: '32514539468', x: 920, y: 315.81 }
    const points = [
      { id: '32360669988', x: 880.5333333333334, y: 201.61 },
      { id: '32577332846', x: 959.4666666666667, y: 247.73 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      current,
      { x: 0, y: -1 },
      dayWidth,
    )?.point.id).toBe('32577332846')
  })

  it('strongly prefers the corridor from the reported example', () => {
    const points = [
      { id: '32360669988', x: -40, y: -114 },
      { id: '31965204291', x: -200, y: 0 },
    ]

    expect(findDirectionalCorridorTarget(
      points,
      origin,
      { x: -1, y: 0 },
      44,
    )?.point.id).toBe('31965204291')
  })
})

describe('createDirectionalNavigationOrigin', () => {
  it('retains the original corridor while staying on one axis', () => {
    const current = { id: 'drifted', x: -20, y: 15 }
    const previous = { axis: 'horizontal', corridor: 0 }

    expect(createDirectionalNavigationOrigin(
      current,
      { x: -1, y: 0 },
      previous,
    )).toMatchObject({
      axis: 'horizontal',
      corridor: 0,
      point: { id: 'drifted', x: -20, y: 0 },
    })
  })

  it('starts a new corridor when changing axes', () => {
    const current = { id: 'drifted', x: -20, y: 15 }
    const previous = { axis: 'horizontal', corridor: 0 }

    expect(createDirectionalNavigationOrigin(
      current,
      { x: 0, y: 1 },
      previous,
    )).toMatchObject({
      axis: 'vertical',
      corridor: -20,
      point: { id: 'drifted', x: -20, y: 15 },
    })
  })
})

describe('tokenizeSearchText', () => {
  it('keeps common language names useful as tokens', () => {
    expect(tokenizeSearchText('C++ and C#')).toEqual(['c++', 'and', 'c#'])
  })

  it('splits acronym-prefixed PascalCase words', () => {
    expect(tokenizeSearchText('HTMLParser')).toEqual(['html', 'parser'])
  })
})
