import { describe, it, expect } from 'vitest'
import type { Page } from 'playwright'
import { BasePage } from './page.js'
import type { ScenarioContext } from './scenario.js'

function makeContext(): { ctx: ScenarioContext; steps: string[]; screenshots: string[] } {
  const steps: string[] = []
  const screenshots: string[] = []
  const ctx: ScenarioContext = {
    page: { fakePage: true } as unknown as Page,
    baseURL: 'http://localhost:3000',
    async step(name, fn) {
      steps.push(name)
      return fn()
    },
    async screenshot(name) {
      screenshots.push(name)
    },
  }
  return { ctx, steps, screenshots }
}

class SamplePage extends BasePage {
  pageRef(): Page {
    return this.page
  }

  contextBaseURL(): string {
    return this.ctx.baseURL
  }

  doStep(): Promise<string> {
    return this.step('sample-step', async () => 'done')
  }

  capture(): Promise<void> {
    return this.screenshot('sample-shot')
  }
}

describe('BasePage', () => {
  it('コンテキストから page を保持する', () => {
    const { ctx } = makeContext()
    const page = new SamplePage(ctx)
    expect(page.pageRef()).toBe(ctx.page)
  })

  it('コンテキスト自体も保持する', () => {
    const { ctx } = makeContext()
    const page = new SamplePage(ctx)
    expect(page.contextBaseURL()).toBe('http://localhost:3000')
  })

  it('step をコンテキストへ委譲する', async () => {
    const { ctx, steps } = makeContext()
    const page = new SamplePage(ctx)
    await expect(page.doStep()).resolves.toBe('done')
    expect(steps).toEqual(['sample-step'])
  })

  it('screenshot をコンテキストへ委譲する', async () => {
    const { ctx, screenshots } = makeContext()
    const page = new SamplePage(ctx)
    await page.capture()
    expect(screenshots).toEqual(['sample-shot'])
  })
})
