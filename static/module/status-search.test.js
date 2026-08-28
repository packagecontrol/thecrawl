import { describe, expect, it } from 'vitest'
import {
  createNotesMatcher,
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

describe('tokenizeSearchText', () => {
  it('keeps common language names useful as tokens', () => {
    expect(tokenizeSearchText('C++ and C#')).toEqual(['c++', 'and', 'c#'])
  })

  it('splits acronym-prefixed PascalCase words', () => {
    expect(tokenizeSearchText('HTMLParser')).toEqual(['html', 'parser'])
  })
})
