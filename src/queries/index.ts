import type { AnyQuery } from '../core/db/query.js'
import { productsQuery } from './products.js'

// fork 所有: システム固有のクエリをここに登録する(サンプルの登録解除もここで行う)
export const queries: AnyQuery[] = [productsQuery]
