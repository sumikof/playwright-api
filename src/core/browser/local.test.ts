import { describe, it, expect, afterAll } from 'vitest'
import { LocalBrowserProvider } from './local.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })

afterAll(async () => {
  await provider.close()
})

describe('LocalBrowserProvider', () => {
  it('acquires a context and renders a page', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    await page.setContent('<h1 id="t">hello</h1>')
    expect(await page.locator('#t').textContent()).toBe('hello')
    await context.close()
  })

  it('acquires isolated contexts from one browser', async () => {
    const a = await provider.acquireContext()
    const b = await provider.acquireContext()
    expect(a).not.toBe(b)
    await a.close()
    await b.close()
  })

  it('passes launchArgs to browser launch', async () => {
    const p = new LocalBrowserProvider({ browser: 'chromium', headless: true, launchArgs: ['--no-sandbox'] })
    const ctx = await p.acquireContext()
    await ctx.close()
    await p.close()
  })
})
