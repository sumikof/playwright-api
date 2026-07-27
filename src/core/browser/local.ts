import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'
import type { BrowserProvider } from './provider.js'

const engines = { chromium, firefox, webkit }

export class LocalBrowserProvider implements BrowserProvider {
  private browser: Browser | null = null

  constructor(
    private readonly opts: { browser: 'chromium' | 'firefox' | 'webkit'; headless: boolean; launchArgs?: string[] },
  ) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser
    this.browser = await engines[this.opts.browser].launch({
      headless: this.opts.headless,
      args: this.opts.launchArgs ?? [],
    })
    return this.browser
  }

  async acquireContext(options?: BrowserContextOptions): Promise<BrowserContext> {
    const browser = await this.ensureBrowser()
    return browser.newContext(options)
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}
