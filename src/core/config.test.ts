import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults when only BASE_URL is set', () => {
    const cfg = loadConfig({ BASE_URL: 'http://localhost:4321' })
    expect(cfg.port).toBe(3000)
    expect(cfg.browser).toBe('chromium')
    expect(cfg.headless).toBe(true)
    expect(cfg.maxConcurrency).toBe(1)
    expect(cfg.maxQueue).toBe(100)
    expect(cfg.runRetention).toBe(50)
    expect(cfg.scenarioTimeoutMs).toBe(120000)
  })

  it('throws when BASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/)
  })

  it('coerces numeric and boolean env vars', () => {
    const cfg = loadConfig({ BASE_URL: 'http://x.test', PORT: '8080', HEADLESS: 'false', MAX_CONCURRENCY: '3' })
    expect(cfg.port).toBe(8080)
    expect(cfg.headless).toBe(false)
    expect(cfg.maxConcurrency).toBe(3)
  })
})
