import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

const VALID_EMAIL = 'user@example.com'
const VALID_PASSWORD = 'correct-password'
const DISPLAY_NAME = 'テストユーザー'

function loginPage(error?: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>ログイン</title></head>
<body>
  <h1>ログイン</h1>
  ${error ? `<p role="alert">${error}</p>` : ''}
  <form method="post" action="/login">
    <label for="email">メールアドレス</label>
    <input id="email" name="email" type="email" />
    <label for="password">パスワード</label>
    <input id="password" name="password" type="password" />
    <button type="submit">ログイン</button>
  </form>
</body></html>`
}

function productsPage(): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>商品一覧</title></head>
<body>
  <h1>商品一覧</h1>
  <p>ようこそ、<span data-testid="user-name">${DISPLAY_NAME}</span> さん</p>
  <ul>
    <li>商品A</li>
    <li>商品B</li>
    <li>商品C</li>
  </ul>
</body></html>`
}

export function createDemoApp(): Hono {
  const app = new Hono()

  app.get('/login', (c) => c.html(loginPage()))

  app.post('/login', async (c) => {
    const body = await c.req.parseBody()
    const email = String(body.email ?? '')
    const password = String(body.password ?? '')
    if (email === VALID_EMAIL && password === VALID_PASSWORD) {
      setCookie(c, 'session', email, { path: '/', httpOnly: true })
      return c.redirect('/products', 302)
    }
    return c.html(loginPage('ログインに失敗しました。資格情報を確認してください。'), 200)
  })

  app.get('/products', (c) => {
    const session = getCookie(c, 'session')
    if (!session) return c.redirect('/login', 302)
    return c.html(productsPage())
  })

  app.get('/', (c) => c.redirect('/login', 302))

  return app
}
