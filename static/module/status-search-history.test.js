import { describe, expect, it } from 'vitest'
import { SearchInputHistory } from './status-search-history.js'

describe('SearchInputHistory', () => {
  it('coalesces adjacent typing within the time window', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('s', 1), {
      group: 'insert',
      timestamp: 0,
    })
    history.record(state('s', 1), state('se', 2), {
      group: 'insert',
      timestamp: 500,
    })

    expect(history.undo(state('se', 2))).toEqual(state(''))
    expect(history.redo(state(''))).toEqual(state('se', 2))
  })

  it('starts a new typing group after the timeout', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('a', 1), {
      group: 'insert',
      timestamp: 0,
    })
    history.record(state('a', 1), state('ab', 2), {
      group: 'insert',
      timestamp: 751,
    })

    expect(history.undo(state('ab', 2))).toEqual(state('a', 1))
    expect(history.undo(state('a', 1))).toEqual(state(''))
  })

  it('keeps semantic edits as separate transactions', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('server', 6), {
      group: 'insert',
      timestamp: 0,
    })
    history.record(state('server', 6), state('"server"', 1, 7, 7), {
      timestamp: 100,
    })

    expect(history.undo(state('"server"', 1, 7, 7)))
      .toEqual(state('server', 6))
    expect(history.undo(state('server', 6))).toEqual(state(''))
  })

  it('breaks typing groups when the selection moves', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('ab', 2), {
      group: 'insert',
      timestamp: 0,
    })
    history.record(state('ab', 1), state('axb', 2), {
      group: 'insert',
      timestamp: 100,
    })

    expect(history.undo(state('axb', 2))).toEqual(state('ab', 1))
    expect(history.undo(state('ab', 1))).toEqual(state(''))
  })

  it('continues undoing after restored metadata is normalized', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('lsp', 3), { group: 'insert' })
    history.record(state('lsp', 3), state('"lsp"', 1, 4, 4))
    history.record(
      state('"lsp"', 0, 5, 4),
      state('candela', 7),
      { group: 'insert' },
    )

    expect(history.undo(state('candela', 7)))
      .toEqual(state('"lsp"', 0, 5, 4))
    expect(history.undo(state('"lsp"', 0, 5, null)))
      .toEqual(state('lsp', 3))
  })

  it('clears redo history after a new edit', () => {
    const history = new SearchInputHistory(state(''))
    history.record(state(''), state('one', 3))
    history.record(state('one', 3), state('two', 3))
    expect(history.undo(state('two', 3))).toEqual(state('one', 3))

    history.record(state('one', 3), state('three', 5))

    expect(history.redo(state('three', 5))).toBeNull()
  })
})

function state(
  value,
  selectionStart = value.length,
  selectionEnd = selectionStart,
  autoPairedQuoteIndex = null,
) {
  return { value, selectionStart, selectionEnd, autoPairedQuoteIndex }
}
