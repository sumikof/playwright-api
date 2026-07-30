import { BasePage } from '../core/page.js'

export class LoginPage extends BasePage {
  private readonly email = () => this.page.getByLabel('メールアドレス')
  private readonly password = () => this.page.getByLabel('パスワード')
  private readonly submitButton = () => this.page.getByRole('button', { name: 'ログイン' })

  async goto(): Promise<void> {
    await this.page.goto('/login')
  }

  async submit(email: string, password: string): Promise<void> {
    await this.email().fill(email)
    await this.password().fill(password)
    await this.submitButton().click()
  }
}
