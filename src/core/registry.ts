import type { AnyScenario } from './scenario.js'

export function buildRegistry(scenarios: readonly AnyScenario[]): Map<string, AnyScenario> {
  const registry = new Map<string, AnyScenario>()
  for (const scenario of scenarios) {
    if (registry.has(scenario.id)) {
      throw new Error(`duplicate scenario id: ${scenario.id}`)
    }
    registry.set(scenario.id, scenario)
  }
  return registry
}
