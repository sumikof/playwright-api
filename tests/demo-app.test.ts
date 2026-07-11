import { describe, it, expect } from 'vitest'
import { createDemoApp } from '../fixtures/demo-app/app.js'

describe('demo-app', () => {
  const app = createDemoApp()

  it('serves the login form', async () => {
    const res = await app.request('/login')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('メールアドレス')
  })

  it('redirects to /products on correct credentials', async () => {
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=user%40example.com&password=correct-password',
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/products')
    expect(res.headers.get('set-cookie')).toContain('session=')
  })

  it('re-renders login with error on wrong credentials', async () => {
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=user%40example.com&password=wrong',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('ログインに失敗')
  })

  it('shows products with the user name when session cookie is present', async () => {
    const res = await app.request('/products', { headers: { cookie: 'session=user@example.com' } })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('商品一覧')
    expect(html).toContain('テストユーザー')
  })

  it('redirects /products to /login without a session', async () => {
    const res = await app.request('/products')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })
})
