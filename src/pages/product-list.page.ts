import type { Page } from 'playwright'

export class ProductListPage {
  constructor(private readonly page: Page) {}

  private readonly heading = () => this.page.getByRole('heading', { name: '商品一覧' })
  private readonly userNameLocator = () => this.page.getByTestId('user-name')

  async expectLoaded(): Promise<void> {
    await this.heading().waitFor({ state: 'visible' })
  }

  async userName(): Promise<string> {
    const text = await this.userNameLocator().textContent()
    return text ?? ''
  }
}
