import { describe, expect, it } from 'vitest'
import {
  createDirectionalNavigationOrigin,
  createNotesHighlightFinder,
  createNotesMatcher,
  createPackageNotesMatcher,
  editAutoPairedSearchQuotes,
  findDirectionalCorridorTarget,
  findDirectionalNavigationTarget,
  findNextNotesMatchIndex,
  findPackageNameSuggestion,
  MIN_NOTES_SEARCH_CHARS,
  notesSearchQueryFromUrl,
  tokenizeSearchText,
  urlWithNotesSearchQuery,
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

  it('matches quoted terms as literal phrases', () => {
    const matcher = createNotesMatcher('"server error"')

    expect(matcher('A SERVER ERROR interrupted the crawl.')).toBe(true)
    expect(matcher('The server returned an error.')).toBe(false)
    expect(matcher('An error occurred on the server.')).toBe(false)
  })

  it('requires quoted phrases and free-form terms together', () => {
    const matcher = createNotesMatcher('retry "server error"')

    expect(matcher('Retrying after a server error.')).toBe(true)
    expect(matcher('Waiting after a server error.')).toBe(false)
    expect(matcher('Retry after the server returned an error.')).toBe(false)
  })
})

describe('createNotesHighlightFinder', () => {
  it('highlights token prefixes without highlighting inside words', () => {
    const findRanges = createNotesHighlightFinder('style')
    const text = 'ThatStyle updates this-style, not lifestyle.'

    expect(highlightedText(text, findRanges)).toEqual(['Style', 'style'])
  })

  it('highlights every free-form term', () => {
    const findRanges = createNotesHighlightFinder('package fail')
    const text = 'The Package is currently failing.'

    expect(highlightedText(text, findRanges)).toEqual(['Package', 'fail'])
  })

  it('highlights quoted phrases as one range', () => {
    const findRanges = createNotesHighlightFinder('retry "server error"')
    const text = 'Retry after a SERVER ERROR.'

    expect(highlightedText(text, findRanges)).toEqual(['Retry', 'SERVER ERROR'])
  })

  it('uses the canonical package name for locked searches', () => {
    const findRanges = createNotesHighlightFinder('scss', 'SCSS Expander')
    const text = 'SCSS was mentioned, then SCSS Expander failed.'

    expect(highlightedText(text, findRanges)).toEqual(['SCSS Expander'])
  })

  it('does not highlight a locked package inside a longer package name', () => {
    const findRanges = createNotesHighlightFinder(
      'LSP',
      'LSP',
      ['LSP', 'LSP-pyright'],
    )
    const text = 'LSP-pyright failed, but LSP was updated.'

    expect(highlightedText(text, findRanges)).toEqual(['LSP'])
  })

  it('stays inactive below the minimum query length', () => {
    expect(createNotesHighlightFinder('s')).toBeNull()
  })
})

describe('editAutoPairedSearchQuotes', () => {
  it('inserts a quote pair into an empty field', () => {
    expect(editAutoPairedSearchQuotes('', 0, 0, '"')).toEqual({
      value: '""',
      caret: 1,
      autoPairedQuoteIndex: 1,
    })
  })

  it('steps over a closing quote', () => {
    expect(editAutoPairedSearchQuotes(
      '"server error"',
      13,
      13,
      '"',
      13,
    )).toEqual({
      value: '"server error"',
      caret: 14,
      autoPairedQuoteIndex: null,
    })
  })

  it('removes both quotes when backspacing between an empty pair', () => {
    expect(editAutoPairedSearchQuotes(
      'retry "" later',
      7,
      7,
      'Backspace',
      7,
    )).toEqual({
      value: 'retry  later',
      caret: 6,
      autoPairedQuoteIndex: null,
    })
  })

  it('surrounds selected text and keeps it selected', () => {
    expect(editAutoPairedSearchQuotes('selected', 0, 8, '"')).toEqual({
      value: '"selected"',
      caret: 1,
      selectionEnd: 9,
      autoPairedQuoteIndex: 9,
    })
  })

  it('does not step over quotes that were not auto-paired', () => {
    expect(editAutoPairedSearchQuotes('"server error"', 13, 13, '"'))
      .toBeNull()
  })

  it('leaves other edits to the browser', () => {
    expect(editAutoPairedSearchQuotes('"server error"', 14, 14, '"'))
      .toBeNull()
  })
})

describe('notes search URLs', () => {
  it('reads decoded searches from the query string', () => {
    expect(notesSearchQueryFromUrl(
      'https://example.com/status/?q=%22server+error%22&run_id=123',
    )).toBe('"server error"')
  })

  it('sets searches without disturbing other URL state', () => {
    const url = urlWithNotesSearchQuery(
      'https://example.com/status/?run_id=123#notes',
      'server error',
    )

    expect(url.searchParams.get('q')).toBe('server error')
    expect(url.searchParams.get('run_id')).toBe('123')
    expect(url.hash).toBe('#notes')
  })

  it('removes empty searches', () => {
    const url = urlWithNotesSearchQuery(
      'https://example.com/status/?run_id=123&q=server',
      '',
    )

    expect(url.searchParams.has('q')).toBe(false)
    expect(url.searchParams.get('run_id')).toBe('123')
  })
})

describe('findPackageNameSuggestion', () => {
  const packageNames = [
    'Candela Color Schemes',
    'LSP-basedpyright',
    'LSP-pyright',
    'PowerPaste',
    'PowerShell',
    'PowershellUtils',
    'Pyrightt Tools',
    'Python 3',
  ]

  it('finds a package by a unique complete name token', () => {
    expect(findPackageNameSuggestion('pyright', packageNames))
      .toBe('LSP-pyright')
    expect(findPackageNameSuggestion('candela', packageNames))
      .toBe('Candela Color Schemes')
  })

  it('allows one typo in a sufficiently long token', () => {
    expect(findPackageNameSuggestion('pyrght', packageNames))
      .toBe('LSP-pyright')
    expect(findPackageNameSuggestion('pyrihgt', packageNames))
      .toBe('LSP-pyright')
    expect(findPackageNameSuggestion('powrshell', packageNames))
      .toBe('PowerShell')
  })

  it('does not suggest packages for partial tokens', () => {
    expect(findPackageNameSuggestion('pyr', packageNames)).toBeNull()
  })

  it('does not choose between ambiguous complete token matches', () => {
    expect(findPackageNameSuggestion('power', packageNames)).toBeNull()
  })

  it('does not suggest packages for literal phrase searches', () => {
    expect(findPackageNameSuggestion('"pyright"', packageNames)).toBeNull()
  })

  it('does not suggest packages for inactive or unrelated searches', () => {
    expect(findPackageNameSuggestion('p', packageNames)).toBeNull()
    expect(findPackageNameSuggestion('ruby', packageNames)).toBeNull()
  })
})

describe('createPackageNotesMatcher', () => {
  const packageNames = [
    'AngularJS',
    'AngularJS (CoffeeScript)',
    'Apiary.io Blueprint',
    'ATG(CocoR C#) Syntax',
    'Candela Color Schemes',
    'Color Scheme',
    'LSP',
    'LSP-pyright',
    'Scheme',
  ]

  it('matches the canonical package name case-insensitively', () => {
    const matcher = createPackageNotesMatcher('Candela Color Schemes', packageNames)

    expect(matcher('Found update for CANDELA color schemes.')).toBe(true)
    expect(matcher('Found updates for Candela and several color schemes.')).toBe(false)
  })

  it('does not match identifier-like package-name extensions', () => {
    const matcher = createPackageNotesMatcher('LSP', packageNames)

    expect(matcher('Found update for LSP.')).toBe(true)
    expect(matcher('Found update for LSP-pyright.')).toBe(false)
    expect(matcher('Found update for LSP_utils.')).toBe(false)
    expect(matcher('Found update for SublimeLSP.')).toBe(false)
  })

  it('still finds a standalone mention after a longer package name', () => {
    const matcher = createPackageNotesMatcher('LSP', packageNames)

    expect(matcher('LSP-pyright failed, but LSP was updated.')).toBe(true)
  })

  it('gives longer known package names precedence across spaces', () => {
    const schemeMatcher = createPackageNotesMatcher('Scheme', packageNames)
    const angularMatcher = createPackageNotesMatcher('AngularJS', packageNames)

    expect(schemeMatcher('Found update for Color Scheme.')).toBe(false)
    expect(schemeMatcher('Found update for color scheme.')).toBe(true)
    expect(schemeMatcher('Found update for Scheme.')).toBe(true)
    expect(angularMatcher('AngularJS (CoffeeScript) failed.')).toBe(false)
  })

  it('treats punctuation in real package names literally', () => {
    const apiaryMatcher = createPackageNotesMatcher('Apiary.io Blueprint', packageNames)
    const atgMatcher = createPackageNotesMatcher('ATG(CocoR C#) Syntax', packageNames)

    expect(apiaryMatcher('Updated **Apiary.io Blueprint**.')).toBe(true)
    expect(apiaryMatcher('Updated ApiaryXio Blueprint.')).toBe(false)
    expect(atgMatcher('Updated ATG(CocoR C#) Syntax.')).toBe(true)
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

describe('findDirectionalNavigationTarget', () => {
  const current = { id: 'current', x: 0, y: 0 }

  it('does not special-case the only other point', () => {
    const other = { id: 'other', x: 30, y: 30 }

    expect(findDirectionalNavigationTarget(
      [current, other],
      current,
      current,
      { x: 0, y: 1 },
      10,
      10,
    )).toBeNull()
  })

  it('falls back horizontally when both corridors are empty', () => {
    const nextDay = { id: 'next-day', x: 20, y: 30 }
    const fartherDay = { id: 'farther-day', x: 30, y: 40 }

    expect(findDirectionalNavigationTarget(
      [current, nextDay, fartherDay],
      current,
      current,
      { x: 1, y: 0 },
      10,
      10,
    )?.point).toBe(nextDay)
  })

  it('does not fall back horizontally when the vertical corridor is occupied', () => {
    const vertical = { id: 'vertical', x: 0, y: 20 }
    const diagonal = { id: 'diagonal', x: 20, y: 30 }

    expect(findDirectionalNavigationTarget(
      [current, vertical, diagonal],
      current,
      current,
      { x: 1, y: 0 },
      10,
      10,
    )).toBeNull()
  })

  it('wraps between occupied days in the horizontal fallback', () => {
    const nextDay = { id: 'next-day', x: 20, y: 30 }
    const lastDay = { id: 'last-day', x: 30, y: 30 }

    expect(findDirectionalNavigationTarget(
      [current, nextDay, lastDay],
      current,
      current,
      { x: -1, y: 0 },
      10,
      10,
    )).toEqual({ point: lastDay, warped: true })
  })

  it('does nothing when a vertical corridor is empty', () => {
    const outsideOne = { id: 'outside-one', x: 20, y: 10 }
    const outsideTwo = { id: 'outside-two', x: 30, y: 20 }

    expect(findDirectionalNavigationTarget(
      [current, outsideOne, outsideTwo],
      current,
      current,
      { x: 0, y: 1 },
      10,
      10,
    )).toBeNull()
  })

  it('keeps using a corridor target when one exists', () => {
    const outside = { id: 'outside', x: 10, y: 30 }
    const inside = { id: 'inside', x: 20, y: 0 }

    expect(findDirectionalNavigationTarget(
      [current, outside, inside],
      current,
      current,
      { x: 1, y: 0 },
      10,
      10,
    )?.point).toBe(inside)
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

function highlightedText(text, findRanges) {
  return findRanges(text).map(range => text.slice(range.start, range.end))
}

describe('tokenizeSearchText', () => {
  it('keeps common language names useful as tokens', () => {
    expect(tokenizeSearchText('C++ and C#')).toEqual(['c++', 'and', 'c#'])
  })

  it('splits acronym-prefixed PascalCase words', () => {
    expect(tokenizeSearchText('HTMLParser')).toEqual(['html', 'parser'])
  })
})
