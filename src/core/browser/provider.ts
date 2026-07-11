import type { BrowserContext, BrowserContextOptions } from 'playwright'
import type { Config } from '../config.js'
import { LocalBrowserProvider } from './local.js'
import { RemoteBrowserProvider } from './remote.js'

export interface BrowserProvider {
  acquireContext(options?: BrowserContextOptions): Promise<BrowserContext>
  close(): Promise<void>
}

export function createBrowserProvider(config: Config): BrowserProvider {
  if (config.browserWsEndpoint) {
    return new RemoteBrowserProvider(config.browserWsEndpoint)
  }
  return new LocalBrowserProvider({ browser: config.browser, headless: config.headless })
}
