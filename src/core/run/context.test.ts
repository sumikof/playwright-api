import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBrowserProvider } from '../browser/local.js'
import { ApiScenarioContext } from './context.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctx-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ApiScenarioContext', () => {
  it('records passed steps', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    const runDir = join(dir, 'R1')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R1')
    const result = await ctx.step('do thing', async () => 42)
    expect(result).toBe(42)
    expect(ctx.steps).toHaveLength(1)
    expect(ctx.steps[0]).toMatchObject({ name: 'do thing', status: 'passed' })
    await context.close()
  })

  it('records failed steps and rethrows', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    const runDir = join(dir, 'R2')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R2')
    await expect(ctx.step('boom', async () => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(ctx.steps[0]).toMatchObject({ name: 'boom', status: 'failed' })
    expect(ctx.steps[0].error?.message).toBe('nope')
    await context.close()
  })

  it('writes flat numbered screenshots and records artifacts', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    await page.setContent('<h1>hi</h1>')
    const runDir = join(dir, 'R3')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R3')
    await ctx.screenshot('product-list')
    const files = await readdir(runDir)
    expect(files).toContain('01-product-list.png')
    expect(ctx.artifacts[0]).toEqual({
      kind: 'screenshot',
      name: '01-product-list.png',
      url: '/runs/R3/artifacts/01-product-list.png',
    })
    await context.close()
  })
})

// afterAll でブラウザを閉じる
import { afterAll } from 'vitest'
afterAll(async () => { await provider.close() })
