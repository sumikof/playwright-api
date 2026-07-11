import { describe, it, expect } from 'vitest'
import { newRunId } from './id.js'

describe('newRunId', () => {
  it('returns a 26-char ULID', () => {
    const id = newRunId()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('produces well-formed 26-char ids on repeated calls', () => {
    const a = newRunId()
    const b = newRunId()
    // Verify both generated IDs are well-formed ULIDs (26 chars).
    expect(a).toHaveLength(26)
    expect(b).toHaveLength(26)
  })
})
