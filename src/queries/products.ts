// fork 所有・サンプル。不要になったら index.ts から登録を外す。
import { z } from '@hono/zod-openapi'
import { defineQuery } from '../core/db/query.js'

export const productsQuery = defineQuery({
  id: 'products',
  summary: '指定価格以上の商品を取得する',
  tags: ['catalog'],
  params: z.object({ minPrice: z.number().int().nonnegative().default(0) }),
  row: z.object({ id: z.number(), name: z.string(), price: z.number() }),
  sql: `
    SELECT id AS "id", name AS "name", price AS "price"
      FROM products
     WHERE price >= :minPrice
     ORDER BY id
  `,
})
