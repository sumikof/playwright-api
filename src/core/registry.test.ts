import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineScenario } from './scenario.js'
import { buildRegistry } from './registry.js'

const makeScenario = (id: string) =>
  defineScenario({
    id,
    summary: `scenario ${id}`,
    tags: [],
    params: z.object({}),
    result: z.object({}),
    async run() {
      return {}
    },
  })

describe('buildRegistry', () => {
  it('maps scenarios by id', () => {
    const reg = buildRegistry([makeScenario('a'), makeScenario('b')])
    expect(reg.size).toBe(2)
    expect(reg.get('a')?.id).toBe('a')
  })

  it('throws on duplicate id', () => {
    expect(() => buildRegistry([makeScenario('a'), makeScenario('a')])).toThrow(/duplicate scenario id: a/)
  })
})
