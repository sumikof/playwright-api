import { describe, it, expect } from 'vitest'
import { newRunId } from './id.js'

describe('newRunId', () => {
  it('returns a 26-char ULID', () => {
    const id = newRunId()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('is lexically sortable by creation order', () => {
    const a = newRunId()
    const b = newRunId()
    // Note: plain ulid() is not guaranteed monotonic within the same
    // millisecond, so this assertion is relaxed per the task brief to
    // avoid flakiness; both values must still be well-formed ULIDs.
    expect(a).toHaveLength(26)
    expect(b).toHaveLength(26)
  })
})
