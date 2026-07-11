import { chromium } from 'playwright'
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'
import type { BrowserProvider } from './provider.js'

export class RemoteBrowserProvider implements BrowserProvider {
  private browser: Browser | null = null

  constructor(private readonly wsEndpoint: string) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser
    this.browser = await chromium.connect(this.wsEndpoint)
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
