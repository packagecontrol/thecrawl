const DEFAULT_COALESCE_MS = 750
const DEFAULT_HISTORY_LIMIT = 100

/**
 * Transaction-based undo history for the notes search input. Adjacent edits
 * with the same non-null group are coalesced within a short time window.
 */
export class SearchInputHistory {
  constructor(initialState, options = {}) {
    this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS
    this.limit = options.limit ?? DEFAULT_HISTORY_LIMIT
    this.entries = [copyState(initialState)]
    this.index = 0
    this.lastEdit = null
  }

  record(beforeState, afterState, options = {}) {
    const before = copyState(beforeState)
    const after = copyState(afterState)
    if (statesEqual(before, after)) return

    const timestamp = options.timestamp ?? Date.now()
    const group = options.group || null
    const current = this.entries[this.index]
    const isContiguous = statesEqual(current, before)
    const canCoalesce = isContiguous
      && group
      && this.lastEdit?.group === group
      && timestamp - this.lastEdit.timestamp <= this.coalesceMs
      && this.lastEdit.index === this.index

    this.entries.length = this.index + 1
    if (!isContiguous) this.entries[this.index] = before

    if (canCoalesce) {
      this.entries[this.index] = after
    }
    else {
      this.entries.push(after)
      this.index += 1
      this.trimToLimit()
    }

    this.lastEdit = { group, index: this.index, timestamp }
  }

  undo(currentState) {
    this.breakGroup()
    if (this.index <= 0) return null

    this.entries[this.index] = copyState(currentState)
    this.index -= 1
    return copyState(this.entries[this.index])
  }

  redo(currentState) {
    this.breakGroup()
    if (this.index >= this.entries.length - 1) return null

    this.entries[this.index] = copyState(currentState)
    this.index += 1
    return copyState(this.entries[this.index])
  }

  breakGroup() {
    this.lastEdit = null
  }

  trimToLimit() {
    const excess = this.entries.length - (this.limit + 1)
    if (excess <= 0) return
    this.entries.splice(0, excess)
    this.index -= excess
  }
}

function copyState(state) {
  return {
    value: String(state?.value || ''),
    selectionStart: Number.isInteger(state?.selectionStart)
      ? state.selectionStart
      : 0,
    selectionEnd: Number.isInteger(state?.selectionEnd)
      ? state.selectionEnd
      : 0,
    autoPairedQuoteIndex: Number.isInteger(state?.autoPairedQuoteIndex)
      ? state.autoPairedQuoteIndex
      : null,
  }
}

function statesEqual(left, right) {
  return left.value === right.value
    && left.selectionStart === right.selectionStart
    && left.selectionEnd === right.selectionEnd
    && left.autoPairedQuoteIndex === right.autoPairedQuoteIndex
}
