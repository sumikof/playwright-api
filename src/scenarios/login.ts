import { z } from '@hono/zod-openapi'
import { defineScenario } from '../core/scenario.js'
import { LoginPage } from '../pages/login.page.js'
import { ProductListPage } from '../pages/product-list.page.js'

export const loginScenario = defineScenario({
  id: 'login',
  summary: 'ログインして商品一覧が表示されることを確認する',
  tags: ['auth'],
  params: z.object({
    email: z.email(),
    password: z.string(),
  }),
  result: z.object({
    userName: z.string(),
  }),

  async run(ctx, params) {
    const login = new LoginPage(ctx)
    await ctx.step('ログイン画面を開く', () => login.goto())
    await ctx.step('資格情報を送信', () => login.submit(params.email, params.password))

    const list = new ProductListPage(ctx)
    await ctx.step('商品一覧の表示を確認', () => list.expectLoaded())
    await ctx.screenshot('product-list')

    return { userName: await list.userName() }
  },
})
