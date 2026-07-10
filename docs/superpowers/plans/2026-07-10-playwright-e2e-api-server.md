# Playwright E2E API サーバ ひな形 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HTTPリクエストでPlaywrightシナリオを実行し結果を返すAPIサーバのひな形を、同一シナリオコードが `@playwright/test` からも実行できる形で構築する。

**Architecture:** シナリオ (`run(ctx, params) => result`) が唯一の実体。HTTP入口 (Hono) は「キュー → runner → BrowserProvider」経由で、テスト入口 (`@playwright/test`) は fixture の `page` から、同じ関数を呼ぶ。状態はインメモリ `Map` + ファイルシステム (`runs/{runId}/`) で持ち、DBは無い。`src/core/` はコピー先で触らない骨格、`src/pages/` `src/scenarios/` `tests/` `fixtures/` がシステム固有。

**Tech Stack:** TypeScript (ESM, NodeNext), Hono + `@hono/zod-openapi` 1.4.0, Zod v4, Playwright (Library API), `@playwright/test`, Vitest, ulid, Node v24。

## Global Constraints

これらは全タスクに暗黙に適用される。各タスクの要件はこのセクションを含む。

- **ESM / NodeNext**: 相対importには `.js` 拡張子を付ける（`import { x } from './foo.js'`）。ソースは `.ts`。
- **Zod は v4**: `z.url()`, `z.stringbool()`, `z.coerce.number()`, `z.prettifyError()`, `z.enum()` を使う。`z.string().url()` は使わない。
- **OpenAPI 用の `z`**: OpenAPIに出すスキーマ（`src/scenarios/`, `core/http/schemas.ts`）は `import { z } from '@hono/zod-openapi'` から取る（`extendZodWithOpenApi` 済みで `.openapi()` が生える）。純粋な検証だけの `core/config.ts` は `import { z } from 'zod'` でよい。どちらも同一の zod v4 実体を指すため型は互換。
- **`@playwright/test` を実行時コードに混ぜない**: `src/core/`（`core/testing/` を除く）, `src/pages/`, `src/scenarios/`, `src/index.ts` は `@playwright/test` を import しない。Page Object の待機は `await locator.waitFor({ state: 'visible' })` を使い、`expect` は使わない。`expect` と `@playwright/test` は `tests/*.spec.ts` と `core/testing/` の中だけ。
- **`playwright` と `@playwright/test` はバージョンを一致させる**（メジャー・マイナー）。
- **アーティファクトはフラットに置く**: `runs/{runId}/01-product-list.png`, `failure.png`, `trace.zip`, `result.json`, `meta.json` を同一階層に。`screenshots/` サブディレクトリは作らない（名前にスラッシュが入ると `GET /runs/{runId}/artifacts/{name}` で受けられないため）。
- **`tsc` ビルド対象は `src` のみ**: `tsconfig.json` に `include: ["src"]`, `rootDir: "src"` を設定する。`tests/` `fixtures/` を `dist/` に出さない。
- **認証・秘匿パラメータのマスクは意図的に入れない**（`params` は `result.json` に平文で残る）。
- **`src/core/` はコピー先で無改変の骨格**。`src/pages/` `src/scenarios/` `tests/` `fixtures/` がシステム固有。
- **タイムスタンプは ISO 文字列**（`new Date().toISOString()`）。`runId` は ULID（生成順ソート可能）。
- devcontainer のブラウザ依存は解決済み（`.devcontainer/features/playwright-deps/`）。リビルドと検証スニペット (`hello`) は確認済み。

---

## File Structure

```
src/
  core/
    config.ts               環境変数の Zod 検証と既定値
    scenario.ts             defineScenario() と Scenario / ScenarioContext 型
    registry.ts             シナリオ配列 → Map、ID重複検出
    browser/
      provider.ts           BrowserProvider インターフェース + createBrowserProvider()
      local.ts              LocalBrowserProvider (chromium/firefox/webkit launch)
      remote.ts             RemoteBrowserProvider (chromium.connect)
    run/
      types.ts              RunResult / StepResult / Artifact / RunMeta / RunJob 型
      id.ts                 ULID 生成
      store.ts              RunStore インターフェース + FileRunStore (Map + FS)
      queue.ts              Queue<J> (MAX_CONCURRENCY / MAX_QUEUE / drain)
      context.ts            ApiScenarioContext
      runner.ts             Runner: context生成→tracing→run()→artifact収集→破棄
      service.ts            RunService: submit()/getResult() (routes と queue の橋渡し)
      retention.ts          起動時の古い run ディレクトリ削除
    testing/
      context.ts            TestScenarioContext (@playwright/test)
      run-in-test.ts        @playwright/test からシナリオを呼ぶヘルパ
    http/
      schemas.ts            RunResult スキーマのファクトリ + 共通スキーマ
      app.ts                OpenAPIHono の組み立て + /doc + /ui
      routes/
        scenarios.ts        レジストリから POST/GET ルートを生成 + GET /scenarios
        artifacts.ts        artifact 配信
        health.ts           GET /health
  pages/                    ★ システム固有: Page Object Model
    login.page.ts
    product-list.page.ts
  scenarios/                ★ システム固有: シナリオ定義
    login.ts
    index.ts                レジストリへの明示登録
  index.ts                  エントリポイント

fixtures/
  demo-app/                 ★ 同梱のテスト対象アプリ（コピー先では削除）
    app.ts                  Hono app: /login と /products
    server.ts               demo-app を単体起動する（playwright webServer 用）

tests/
  login.spec.ts             @playwright/test 経由でシナリオを実行
  api.integration.test.ts   demo-app + API を in-process で起動し POST→ポーリング

playwright.config.ts
vitest.config.ts
runs/                       実行結果（gitignore）
```

---

## Task 1: 依存追加とビルド/テスト設定

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし（リポジトリは `hono create` 直後のスケルトン）
- Produces: `npm test` が Vitest を、`npx playwright test` が Playwright を起動できる状態。`playwright`, `@playwright/test`, `vitest`, `ulid` が依存に入る。

- [ ] **Step 1: ブラウザ起動を再確認（検証スニペット）**

Run:
```bash
npm install
npx playwright install chromium
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await(await b.newContext()).newPage();await p.setContent('<h1 id=t>hello</h1>');console.log(await p.locator('#t').textContent());await b.close();})();"
```
Expected: `hello` と出力（引き継ぎ書で確認済み。再確認）。

- [ ] **Step 2: 依存を追加**

Run:
```bash
npm install playwright @playwright/test ulid
npm install -D vitest
```
Expected: `package.json` の `dependencies` に `playwright`, `ulid`、`devDependencies` に `@playwright/test`, `vitest` が入る。`playwright` と `@playwright/test` が同一バージョンであることを `npm ls playwright @playwright/test` で確認する。

- [ ] **Step 3: `package.json` の scripts を更新**

`scripts` を以下にする（既存の `dev`/`build`/`start` は残す）:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
```

- [ ] **Step 4: `tsconfig.json` にビルド対象を絞る設定を追加**

`compilerOptions` に `rootDir` を足し、トップレベルに `include` を足す:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "NodeNext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 5: `vitest.config.ts` を作成**

`tests/*.spec.ts`（Playwright 用）を除外し、`*.test.ts` だけを対象にする:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/**/*.spec.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})
```

- [ ] **Step 6: `playwright.config.ts` を作成**

`tests/*.spec.ts` だけを対象にし、`fixtures/demo-app` を webServer として起動する。`webServer.command` は Task 10 で作る `server.ts` を指す:

```ts
import { defineConfig } from '@playwright/test'

const PORT = 4321
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  use: { baseURL },
  webServer: {
    command: `npx tsx fixtures/demo-app/server.ts`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
})
```

- [ ] **Step 7: `.gitignore` に `runs/` と `dist/` を追加**

`.gitignore` の末尾に追記:

```
# build & run artifacts
dist/
runs/
test-results/
playwright-report/
```

- [ ] **Step 8: ビルドが通ることを確認**

Run: `npm run build`
Expected: エラーなく `dist/` が生成される（この時点では `src/index.ts` はスケルトンのまま）。

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts playwright.config.ts .gitignore
git commit -m "chore: add playwright/vitest deps and build/test config"
```

---

## Task 2: 環境変数の設定 (`core/config.ts`)

**Files:**
- Create: `src/core/config.ts`
- Test: `src/core/config.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface Config { port: number; baseURL: string; browser: 'chromium'|'firefox'|'webkit'; headless: boolean; browserWsEndpoint?: string; maxConcurrency: number; maxQueue: number; runsDir: string; runRetention: number; scenarioTimeoutMs: number }`
  - `function loadConfig(env?: NodeJS.ProcessEnv): Config` — 不正なら例外を投げる。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from './config.js'

describe('loadConfig', () => {
  it('applies defaults when only BASE_URL is set', () => {
    const cfg = loadConfig({ BASE_URL: 'http://localhost:4321' })
    expect(cfg.port).toBe(3000)
    expect(cfg.browser).toBe('chromium')
    expect(cfg.headless).toBe(true)
    expect(cfg.maxConcurrency).toBe(1)
    expect(cfg.maxQueue).toBe(100)
    expect(cfg.runRetention).toBe(50)
    expect(cfg.scenarioTimeoutMs).toBe(120000)
  })

  it('throws when BASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/Invalid configuration/)
  })

  it('coerces numeric and boolean env vars', () => {
    const cfg = loadConfig({ BASE_URL: 'http://x.test', PORT: '8080', HEADLESS: 'false', MAX_CONCURRENCY: '3' })
    expect(cfg.port).toBe(8080)
    expect(cfg.headless).toBe(false)
    expect(cfg.maxConcurrency).toBe(3)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/config.test.ts`
Expected: FAIL（`config.js` が存在しない / `loadConfig` 未定義）。

- [ ] **Step 3: 最小実装を書く**

Create `src/core/config.ts`:

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_URL: z.url(),
  BROWSER: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  HEADLESS: z.stringbool().default(true),
  BROWSER_WS_ENDPOINT: z.url().optional(),
  MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  MAX_QUEUE: z.coerce.number().int().positive().default(100),
  RUNS_DIR: z.string().default('./runs'),
  RUN_RETENTION: z.coerce.number().int().positive().default(50),
  SCENARIO_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
})

export interface Config {
  port: number
  baseURL: string
  browser: 'chromium' | 'firefox' | 'webkit'
  headless: boolean
  browserWsEndpoint?: string
  maxConcurrency: number
  maxQueue: number
  runsDir: string
  runRetention: number
  scenarioTimeoutMs: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error('Invalid configuration:\n' + z.prettifyError(parsed.error))
  }
  const e = parsed.data
  return {
    port: e.PORT,
    baseURL: e.BASE_URL,
    browser: e.BROWSER,
    headless: e.HEADLESS,
    browserWsEndpoint: e.BROWSER_WS_ENDPOINT,
    maxConcurrency: e.MAX_CONCURRENCY,
    maxQueue: e.MAX_QUEUE,
    runsDir: e.RUNS_DIR,
    runRetention: e.RUN_RETENTION,
    scenarioTimeoutMs: e.SCENARIO_TIMEOUT_MS,
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/config.test.ts`
Expected: PASS（3件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "feat: add config loader with zod env validation"
```

---

## Task 3: シナリオ定義とレジストリ (`core/scenario.ts`, `core/registry.ts`)

**Files:**
- Create: `src/core/scenario.ts`
- Create: `src/core/registry.ts`
- Test: `src/core/registry.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `interface ScenarioContext { readonly page: Page; readonly baseURL: string; step<T>(name: string, fn: () => Promise<T>): Promise<T>; screenshot(name: string): Promise<void> }`
  - `interface Scenario<P extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> { id: string; summary: string; tags: string[]; params: P; result: R; run(ctx: ScenarioContext, params: z.infer<P>): Promise<z.infer<R>> }`
  - `function defineScenario<P, R>(scenario: Scenario<P, R>): Scenario<P, R>`
  - `type AnyScenario = Scenario`
  - `function buildRegistry(scenarios: readonly AnyScenario[]): Map<string, AnyScenario>` — ID重複で例外。

- [ ] **Step 1: `core/scenario.ts` を書く**（型定義のみ。テストは registry で行う）

Create `src/core/scenario.ts`:

```ts
import type { Page } from 'playwright'
import type { z } from 'zod'

export interface ScenarioContext {
  readonly page: Page
  readonly baseURL: string
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  screenshot(name: string): Promise<void>
}

export interface Scenario<
  P extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  id: string
  summary: string
  tags: string[]
  params: P
  result: R
  run(ctx: ScenarioContext, params: z.infer<P>): Promise<z.infer<R>>
}

export type AnyScenario = Scenario

export function defineScenario<P extends z.ZodType, R extends z.ZodType>(
  scenario: Scenario<P, R>,
): Scenario<P, R> {
  return scenario
}
```

- [ ] **Step 2: 失敗するテストを書く**

Create `src/core/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineScenario } from './scenario.js'
import { buildRegistry } from './registry.js'

const makeScenario = (id: string) =>
  defineScenario({
    id,
    summary: `scenario ${id}`,
    tags: [],
    params: z.object({}),
    result: z.object({}),
    async run() {
      return {}
    },
  })

describe('buildRegistry', () => {
  it('maps scenarios by id', () => {
    const reg = buildRegistry([makeScenario('a'), makeScenario('b')])
    expect(reg.size).toBe(2)
    expect(reg.get('a')?.id).toBe('a')
  })

  it('throws on duplicate id', () => {
    expect(() => buildRegistry([makeScenario('a'), makeScenario('a')])).toThrow(/duplicate scenario id: a/)
  })
})
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npx vitest run src/core/registry.test.ts`
Expected: FAIL（`registry.js` / `buildRegistry` 未定義）。

- [ ] **Step 4: `core/registry.ts` を実装**

Create `src/core/registry.ts`:

```ts
import type { AnyScenario } from './scenario.js'

export function buildRegistry(scenarios: readonly AnyScenario[]): Map<string, AnyScenario> {
  const registry = new Map<string, AnyScenario>()
  for (const scenario of scenarios) {
    if (registry.has(scenario.id)) {
      throw new Error(`duplicate scenario id: ${scenario.id}`)
    }
    registry.set(scenario.id, scenario)
  }
  return registry
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/core/registry.test.ts`
Expected: PASS（2件）。

- [ ] **Step 6: Commit**

```bash
git add src/core/scenario.ts src/core/registry.ts src/core/registry.test.ts
git commit -m "feat: add scenario definition and registry"
```

---

## Task 4: 実行結果の型と ULID (`core/run/types.ts`, `core/run/id.ts`)

**Files:**
- Create: `src/core/run/types.ts`
- Create: `src/core/run/id.ts`
- Test: `src/core/run/id.test.ts`

**Interfaces:**
- Consumes: `Scenario` (`core/scenario.ts`)
- Produces:
  - `type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'interrupted'`
  - `interface StepResult { name: string; status: 'passed' | 'failed'; durationMs: number; error?: { message: string } }`
  - `type ArtifactKind = 'screenshot' | 'trace'`
  - `interface Artifact { kind: ArtifactKind; name: string; url: string }`
  - `interface RunResult { runId; scenarioId; status: RunStatus; params: unknown; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; steps: StepResult[]; data: unknown; error: { message: string; stack?: string } | null; artifacts: Artifact[] }`
  - `interface RunMeta { runId: string; scenarioId: string; params: unknown; queuedAt: string }`
  - `interface RunJob { runId: string; scenario: AnyScenario; params: unknown; queuedAt: string }`
  - `function newRunId(): string`

- [ ] **Step 1: `core/run/types.ts` を書く**

Create `src/core/run/types.ts`:

```ts
import type { AnyScenario } from '../scenario.js'

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'interrupted'

export interface StepResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: { message: string }
}

export type ArtifactKind = 'screenshot' | 'trace'

export interface Artifact {
  kind: ArtifactKind
  name: string
  url: string
}

export interface RunResult {
  runId: string
  scenarioId: string
  status: RunStatus
  params: unknown
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  steps: StepResult[]
  data: unknown
  error: { message: string; stack?: string } | null
  artifacts: Artifact[]
}

export interface RunMeta {
  runId: string
  scenarioId: string
  params: unknown
  queuedAt: string
}

export interface RunJob {
  runId: string
  scenario: AnyScenario
  params: unknown
  queuedAt: string
}
```

- [ ] **Step 2: 失敗するテストを書く**

Create `src/core/run/id.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { newRunId } from './id.js'

describe('newRunId', () => {
  it('returns a 26-char ULID', () => {
    const id = newRunId()
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('is lexically sortable by creation order', () => {
    const a = newRunId()
    const b = newRunId()
    expect(a <= b).toBe(true)
  })
})
```

- [ ] **Step 3: テストが落ちることを確認**

Run: `npx vitest run src/core/run/id.test.ts`
Expected: FAIL（`id.js` / `newRunId` 未定義）。

- [ ] **Step 4: `core/run/id.ts` を実装**

Create `src/core/run/id.ts`:

```ts
import { ulid } from 'ulid'

export function newRunId(): string {
  return ulid()
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/core/run/id.test.ts`
Expected: PASS（2件）。まれに同一ミリ秒で `a <= b` が単調増加保証される点は ulid のモノトニック実装に依存する。落ちた場合は連続呼び出し間に依存しない別アサーション（両方が26文字であること）に緩めてよい。

- [ ] **Step 6: Commit**

```bash
git add src/core/run/types.ts src/core/run/id.ts src/core/run/id.test.ts
git commit -m "feat: add run result types and ulid id generator"
```

---

## Task 5: 実行結果ストア (`core/run/store.ts`)

**Files:**
- Create: `src/core/run/store.ts`
- Test: `src/core/run/store.test.ts`

**Interfaces:**
- Consumes: `RunResult`, `RunMeta` (`core/run/types.ts`)
- Produces:
  - `interface RunStore { create(runId: string, scenarioId: string, params: unknown, queuedAt: string): Promise<void>; markRunning(runId: string, startedAt: string): Promise<void>; finish(runId: string, result: RunResult): Promise<void>; get(runId: string): Promise<RunResult | undefined> }`
  - `class FileRunStore implements RunStore` — `constructor(runsDir: string)`。
  - `get()` の探索順: メモリ Map → `result.json` → `meta.json`（→ `interrupted`）→ `undefined`。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/run/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileRunStore } from './store.js'
import type { RunResult } from './types.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runstore-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const finishedResult = (runId: string): RunResult => ({
  runId,
  scenarioId: 'login',
  status: 'passed',
  params: { email: 'a@b.c' },
  queuedAt: '2026-07-10T00:00:00.000Z',
  startedAt: '2026-07-10T00:00:01.000Z',
  finishedAt: '2026-07-10T00:00:02.000Z',
  durationMs: 1000,
  steps: [],
  data: { userName: 'x' },
  error: null,
  artifacts: [],
})

describe('FileRunStore', () => {
  it('returns the in-memory record after create', async () => {
    const store = new FileRunStore(dir)
    await store.create('R1', 'login', { email: 'a@b.c' }, '2026-07-10T00:00:00.000Z')
    const got = await store.get('R1')
    expect(got?.status).toBe('queued')
    expect(got?.startedAt).toBeNull()
  })

  it('marks a run as running with startedAt', async () => {
    const store = new FileRunStore(dir)
    await store.create('R1', 'login', {}, '2026-07-10T00:00:00.000Z')
    await store.markRunning('R1', '2026-07-10T00:00:01.000Z')
    const got = await store.get('R1')
    expect(got?.status).toBe('running')
    expect(got?.startedAt).toBe('2026-07-10T00:00:01.000Z')
  })

  it('reads result.json from disk when not in memory', async () => {
    const store = new FileRunStore(dir)
    const result = finishedResult('R2')
    await mkdir(join(dir, 'R2'), { recursive: true })
    await writeFile(join(dir, 'R2', 'result.json'), JSON.stringify(result))
    const got = await store.get('R2') // fresh store, nothing in memory
    expect(got?.status).toBe('passed')
    expect(got?.data).toEqual({ userName: 'x' })
  })

  it('returns interrupted when only meta.json exists', async () => {
    const store = new FileRunStore(dir)
    await mkdir(join(dir, 'R3'), { recursive: true })
    await writeFile(
      join(dir, 'R3', 'meta.json'),
      JSON.stringify({ runId: 'R3', scenarioId: 'login', params: {}, queuedAt: '2026-07-10T00:00:00.000Z' }),
    )
    const got = await store.get('R3')
    expect(got?.status).toBe('interrupted')
    expect(got?.scenarioId).toBe('login')
  })

  it('returns undefined for unknown runId', async () => {
    const store = new FileRunStore(dir)
    expect(await store.get('nope')).toBeUndefined()
  })

  it('writes result.json on finish', async () => {
    const store = new FileRunStore(dir)
    await store.create('R4', 'login', {}, '2026-07-10T00:00:00.000Z')
    await store.finish('R4', finishedResult('R4'))
    const fresh = new FileRunStore(dir)
    expect((await fresh.get('R4'))?.status).toBe('passed')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/store.test.ts`
Expected: FAIL（`store.js` / `FileRunStore` 未定義）。

- [ ] **Step 3: `core/run/store.ts` を実装**

Create `src/core/run/store.ts`:

```ts
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunResult, RunMeta } from './types.js'

export interface RunStore {
  create(runId: string, scenarioId: string, params: unknown, queuedAt: string): Promise<void>
  markRunning(runId: string, startedAt: string): Promise<void>
  finish(runId: string, result: RunResult): Promise<void>
  get(runId: string): Promise<RunResult | undefined>
}

export class FileRunStore implements RunStore {
  private readonly memory = new Map<string, RunResult>()

  constructor(private readonly runsDir: string) {}

  private runDir(runId: string): string {
    return join(this.runsDir, runId)
  }

  async create(runId: string, scenarioId: string, params: unknown, queuedAt: string): Promise<void> {
    const queued: RunResult = {
      runId,
      scenarioId,
      status: 'queued',
      params,
      queuedAt,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      steps: [],
      data: null,
      error: null,
      artifacts: [],
    }
    this.memory.set(runId, queued)
    const meta: RunMeta = { runId, scenarioId, params, queuedAt }
    await mkdir(this.runDir(runId), { recursive: true })
    await writeFile(join(this.runDir(runId), 'meta.json'), JSON.stringify(meta, null, 2))
  }

  async markRunning(runId: string, startedAt: string): Promise<void> {
    const entry = this.memory.get(runId)
    if (entry) {
      entry.status = 'running'
      entry.startedAt = startedAt
    }
  }

  async finish(runId: string, result: RunResult): Promise<void> {
    this.memory.set(runId, result)
    await mkdir(this.runDir(runId), { recursive: true })
    await writeFile(join(this.runDir(runId), 'result.json'), JSON.stringify(result, null, 2))
  }

  async get(runId: string): Promise<RunResult | undefined> {
    const inMemory = this.memory.get(runId)
    if (inMemory) return inMemory

    const resultJson = await this.tryRead(join(this.runDir(runId), 'result.json'))
    if (resultJson) return JSON.parse(resultJson) as RunResult

    const metaJson = await this.tryRead(join(this.runDir(runId), 'meta.json'))
    if (metaJson) {
      const meta = JSON.parse(metaJson) as RunMeta
      return {
        runId: meta.runId,
        scenarioId: meta.scenarioId,
        status: 'interrupted',
        params: meta.params,
        queuedAt: meta.queuedAt,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        steps: [],
        data: null,
        error: { message: 'Run interrupted by process restart' },
        artifacts: [],
      }
    }

    return undefined
  }

  private async tryRead(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return undefined
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/store.test.ts`
Expected: PASS（6件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/store.ts src/core/run/store.test.ts
git commit -m "feat: add FileRunStore (memory + fs, interrupted recovery)"
```

---

## Task 6: 実行キュー (`core/run/queue.ts`)

**Files:**
- Create: `src/core/run/queue.ts`
- Test: `src/core/run/queue.test.ts`

**Interfaces:**
- Consumes: なし（ジョブ型はジェネリック `J`）
- Produces:
  - `interface QueueOptions { maxConcurrency: number; maxQueue: number }`
  - `class Queue<J> { constructor(opts: QueueOptions, worker: (job: J) => Promise<void>); hasCapacity(): boolean; enqueue(job: J): boolean; drain(): Promise<void>; readonly stats: { waiting: number; running: number } }`
  - `enqueue` は満杯 (`waiting.length >= maxQueue`) または draining 中は `false` を返す。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/run/queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Queue } from './queue.js'

// 手動で解決できる deferred を作るヘルパ
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('Queue', () => {
  it('does not run more than maxConcurrency workers at once', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let active = 0
    let maxActive = 0
    const q = new Queue<number>({ maxConcurrency: 1, maxQueue: 10 }, async (i) => {
      active++
      maxActive = Math.max(maxActive, active)
      await gates[i].promise
      active--
    })
    q.enqueue(0)
    q.enqueue(1)
    q.enqueue(2)
    // 1本だけ走っているはず
    await Promise.resolve()
    expect(q.stats.running).toBe(1)
    gates[0].resolve()
    gates[1].resolve()
    gates[2].resolve()
    await q.drain()
    expect(maxActive).toBe(1)
  })

  it('rejects enqueue when queue is full', () => {
    const q = new Queue<number>({ maxConcurrency: 1, maxQueue: 1 }, async () => {
      await new Promise(() => {}) // 永久に走り続ける
    })
    expect(q.enqueue(0)).toBe(true) // すぐ running になる
    expect(q.enqueue(1)).toBe(true) // waiting に1件（maxQueue=1）
    expect(q.enqueue(2)).toBe(false) // 満杯
    expect(q.hasCapacity()).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/queue.test.ts`
Expected: FAIL（`queue.js` / `Queue` 未定義）。

- [ ] **Step 3: `core/run/queue.ts` を実装**

Create `src/core/run/queue.ts`:

```ts
export interface QueueOptions {
  maxConcurrency: number
  maxQueue: number
}

export class Queue<J> {
  private readonly waiting: J[] = []
  private running = 0
  private draining = false
  private readonly idleResolvers: Array<() => void> = []

  constructor(
    private readonly opts: QueueOptions,
    private readonly worker: (job: J) => Promise<void>,
  ) {}

  hasCapacity(): boolean {
    return !this.draining && this.waiting.length < this.opts.maxQueue
  }

  enqueue(job: J): boolean {
    if (this.draining) return false
    if (this.waiting.length >= this.opts.maxQueue) return false
    this.waiting.push(job)
    this.pump()
    return true
  }

  private pump(): void {
    while (this.running < this.opts.maxConcurrency && this.waiting.length > 0) {
      const job = this.waiting.shift() as J
      this.running++
      void this.worker(job)
        .catch(() => {})
        .finally(() => {
          this.running--
          this.pump()
          this.checkIdle()
        })
    }
  }

  private checkIdle(): void {
    if (this.running === 0 && this.waiting.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) resolve()
    }
  }

  async drain(): Promise<void> {
    this.draining = true
    if (this.running === 0 && this.waiting.length === 0) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  get stats(): { waiting: number; running: number } {
    return { waiting: this.waiting.length, running: this.running }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/queue.test.ts`
Expected: PASS（2件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/queue.ts src/core/run/queue.test.ts
git commit -m "feat: add concurrency-limited job queue with drain"
```

---

## Task 7: ブラウザ調達 (`core/browser/`)

**Files:**
- Create: `src/core/browser/provider.ts`
- Create: `src/core/browser/local.ts`
- Create: `src/core/browser/remote.ts`
- Test: `src/core/browser/local.test.ts`

**Interfaces:**
- Consumes: `Config` (`core/config.ts`)
- Produces:
  - `interface BrowserProvider { acquireContext(options?: BrowserContextOptions): Promise<BrowserContext>; close(): Promise<void> }`
  - `class LocalBrowserProvider implements BrowserProvider` — `constructor(opts: { browser: 'chromium'|'firefox'|'webkit'; headless: boolean })`
  - `class RemoteBrowserProvider implements BrowserProvider` — `constructor(wsEndpoint: string)`
  - `function createBrowserProvider(config: Config): BrowserProvider` — `browserWsEndpoint` があれば Remote、なければ Local。

- [ ] **Step 1: `core/browser/provider.ts` を書く**

Create `src/core/browser/provider.ts`:

```ts
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
```

- [ ] **Step 2: `core/browser/local.ts` を書く**

Create `src/core/browser/local.ts`:

```ts
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright'
import type { BrowserProvider } from './provider.js'

const engines = { chromium, firefox, webkit }

export class LocalBrowserProvider implements BrowserProvider {
  private browser: Browser | null = null

  constructor(private readonly opts: { browser: 'chromium' | 'firefox' | 'webkit'; headless: boolean }) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) return this.browser
    this.browser = await engines[this.opts.browser].launch({ headless: this.opts.headless })
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
```

- [ ] **Step 3: `core/browser/remote.ts` を書く**

Create `src/core/browser/remote.ts`:

```ts
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
```

- [ ] **Step 4: 失敗するテストを書く**（実ブラウザ1本を起動して疎通確認）

Create `src/core/browser/local.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { LocalBrowserProvider } from './local.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })

afterAll(async () => {
  await provider.close()
})

describe('LocalBrowserProvider', () => {
  it('acquires a context and renders a page', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    await page.setContent('<h1 id="t">hello</h1>')
    expect(await page.locator('#t').textContent()).toBe('hello')
    await context.close()
  })

  it('acquires isolated contexts from one browser', async () => {
    const a = await provider.acquireContext()
    const b = await provider.acquireContext()
    expect(a).not.toBe(b)
    await a.close()
    await b.close()
  })
})
```

- [ ] **Step 5: テストが落ちる→通ることを確認**

Run: `npx vitest run src/core/browser/local.test.ts`
Expected: 実装は Step 1-3 で済んでいるので PASS（2件）。もしブラウザ起動で sandbox エラーが出たら、`local.ts` の `launch({ headless: this.opts.headless })` を `launch({ headless: this.opts.headless, args: ['--no-sandbox'] })` にする（引き継ぎ書の注記）。

- [ ] **Step 6: Commit**

```bash
git add src/core/browser/
git commit -m "feat: add BrowserProvider (local launch, remote connect)"
```

---

## Task 8: シナリオ実行コンテキスト (`core/run/context.ts`)

**Files:**
- Create: `src/core/run/context.ts`
- Test: `src/core/run/context.test.ts`

**Interfaces:**
- Consumes: `ScenarioContext` (`core/scenario.ts`), `StepResult`, `Artifact` (`core/run/types.ts`), Playwright `Page`
- Produces:
  - `class ApiScenarioContext implements ScenarioContext` — `constructor(page: Page, baseURL: string, runDir: string, runId: string)`
  - `readonly steps: StepResult[]` と `readonly artifacts: Artifact[]` を公開（runner が読む）。
  - `step` は所要時間と成否を `steps` に記録し、失敗時は例外を再送出。`screenshot(name)` は `runDir` に `NN-name.png`（フラット、連番前置）を書き `artifacts` に追加。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/run/context.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBrowserProvider } from '../browser/local.js'
import { ApiScenarioContext } from './context.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })
let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ctx-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ApiScenarioContext', () => {
  it('records passed steps', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    const runDir = join(dir, 'R1')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R1')
    const result = await ctx.step('do thing', async () => 42)
    expect(result).toBe(42)
    expect(ctx.steps).toHaveLength(1)
    expect(ctx.steps[0]).toMatchObject({ name: 'do thing', status: 'passed' })
    await context.close()
  })

  it('records failed steps and rethrows', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    const runDir = join(dir, 'R2')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R2')
    await expect(ctx.step('boom', async () => { throw new Error('nope') })).rejects.toThrow('nope')
    expect(ctx.steps[0]).toMatchObject({ name: 'boom', status: 'failed' })
    expect(ctx.steps[0].error?.message).toBe('nope')
    await context.close()
  })

  it('writes flat numbered screenshots and records artifacts', async () => {
    const context = await provider.acquireContext()
    const page = await context.newPage()
    await page.setContent('<h1>hi</h1>')
    const runDir = join(dir, 'R3')
    await mkdir(runDir, { recursive: true })
    const ctx = new ApiScenarioContext(page, 'http://x.test', runDir, 'R3')
    await ctx.screenshot('product-list')
    const files = await readdir(runDir)
    expect(files).toContain('01-product-list.png')
    expect(ctx.artifacts[0]).toEqual({
      kind: 'screenshot',
      name: '01-product-list.png',
      url: '/runs/R3/artifacts/01-product-list.png',
    })
    await context.close()
  })
})

// afterAll でブラウザを閉じる
import { afterAll } from 'vitest'
afterAll(async () => { await provider.close() })
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/context.test.ts`
Expected: FAIL（`context.js` / `ApiScenarioContext` 未定義）。

- [ ] **Step 3: `core/run/context.ts` を実装**

Create `src/core/run/context.ts`:

```ts
import { join } from 'node:path'
import type { Page } from 'playwright'
import type { ScenarioContext } from '../scenario.js'
import type { StepResult, Artifact } from './types.js'

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class ApiScenarioContext implements ScenarioContext {
  readonly steps: StepResult[] = []
  readonly artifacts: Artifact[] = []
  private screenshotIndex = 0

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly runDir: string,
    private readonly runId: string,
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this.steps.push({ name, status: 'passed', durationMs: Date.now() - start })
      return result
    } catch (e) {
      this.steps.push({ name, status: 'failed', durationMs: Date.now() - start, error: { message: errMessage(e) } })
      throw e
    }
  }

  async screenshot(name: string): Promise<void> {
    this.screenshotIndex++
    const fileName = `${String(this.screenshotIndex).padStart(2, '0')}-${name}.png`
    await this.page.screenshot({ path: join(this.runDir, fileName), fullPage: true })
    this.artifacts.push({
      kind: 'screenshot',
      name: fileName,
      url: `/runs/${this.runId}/artifacts/${fileName}`,
    })
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/context.test.ts`
Expected: PASS（3件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/context.ts src/core/run/context.test.ts
git commit -m "feat: add ApiScenarioContext with step/screenshot recording"
```

---

## Task 9: runner (`core/run/runner.ts`)

**Files:**
- Create: `src/core/run/runner.ts`
- Test: `src/core/run/runner.test.ts`

**Interfaces:**
- Consumes: `BrowserProvider`, `RunStore`, `ApiScenarioContext`, `RunJob`, `RunResult` 型、`Scenario`
- Produces:
  - `interface RunnerDeps { provider: BrowserProvider; store: RunStore; baseURL: string; runsDir: string; timeoutMs: number }`
  - `class Runner { constructor(deps: RunnerDeps); run(job: RunJob): Promise<void> }`
  - ライフサイクル: `markRunning` → context取得 → tracing開始 → `scenario.run` をタイムアウト付きで実行 → 成功時は `result` スキーマ検証、失敗時は `failure.png` + `trace.zip` → `context.close`（finally）→ `store.finish`。

- [ ] **Step 1: 失敗するテストを書く**（provider を fake にしてブラウザ非依存でロジックを検証。ただし実 Page が必要なので Local を1本使う）

Create `src/core/run/runner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { LocalBrowserProvider } from '../browser/local.js'
import { FileRunStore } from './store.js'
import { Runner } from './runner.js'
import { defineScenario } from '../scenario.js'
import type { RunJob } from './types.js'

const provider = new LocalBrowserProvider({ browser: 'chromium', headless: true })
let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'runner-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })
afterAll(async () => { await provider.close() })

const okScenario = defineScenario({
  id: 'ok',
  summary: 'always passes',
  tags: [],
  params: z.object({}),
  result: z.object({ value: z.string() }),
  async run(ctx) {
    await ctx.step('render', async () => {
      await ctx.page.setContent('<h1>ok</h1>')
    })
    await ctx.screenshot('done')
    return { value: 'hello' }
  },
})

const failScenario = defineScenario({
  id: 'fail',
  summary: 'always fails',
  tags: [],
  params: z.object({}),
  result: z.object({}),
  async run(ctx) {
    await ctx.page.setContent('<h1>fail</h1>')
    await ctx.step('boom', async () => { throw new Error('kaboom') })
    return {}
  },
})

function job(scenario: RunJob['scenario'], runId: string): RunJob {
  return { runId, scenario, params: {}, queuedAt: '2026-07-10T00:00:00.000Z' }
}

describe('Runner', () => {
  it('runs a passing scenario, validates result, keeps screenshot, no trace', async () => {
    const store = new FileRunStore(dir)
    const runner = new Runner({ provider, store, baseURL: 'http://x.test', runsDir: dir, timeoutMs: 30000 })
    await store.create('P1', 'ok', {}, '2026-07-10T00:00:00.000Z')
    await runner.run(job(okScenario, 'P1'))
    const result = await store.get('P1')
    expect(result?.status).toBe('passed')
    expect(result?.data).toEqual({ value: 'hello' })
    expect(result?.startedAt).not.toBeNull()
    expect(result?.durationMs).toBeGreaterThanOrEqual(0)
    const files = await readdir(join(dir, 'P1'))
    expect(files).toContain('01-done.png')
    expect(files).not.toContain('trace.zip')
  })

  it('runs a failing scenario, saves failure.png and trace.zip', async () => {
    const store = new FileRunStore(dir)
    const runner = new Runner({ provider, store, baseURL: 'http://x.test', runsDir: dir, timeoutMs: 30000 })
    await store.create('F1', 'fail', {}, '2026-07-10T00:00:00.000Z')
    await runner.run(job(failScenario, 'F1'))
    const result = await store.get('F1')
    expect(result?.status).toBe('failed')
    expect(result?.data).toBeNull()
    expect(result?.error?.message).toContain('kaboom')
    const kinds = result?.artifacts.map((a) => a.name) ?? []
    expect(kinds).toContain('failure.png')
    expect(kinds).toContain('trace.zip')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/runner.test.ts`
Expected: FAIL（`runner.js` / `Runner` 未定義）。

- [ ] **Step 3: `core/run/runner.ts` を実装**

Create `src/core/run/runner.ts`:

```ts
import { join } from 'node:path'
import type { BrowserContext } from 'playwright'
import type { BrowserProvider } from '../browser/provider.js'
import type { RunStore } from './store.js'
import { ApiScenarioContext } from './context.js'
import type { RunJob, RunResult, Artifact } from './types.js'

export interface RunnerDeps {
  provider: BrowserProvider
  store: RunStore
  baseURL: string
  runsDir: string
  timeoutMs: number
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function errStack(e: unknown): string | undefined {
  return e instanceof Error ? e.stack : undefined
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Scenario timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export class Runner {
  constructor(private readonly deps: RunnerDeps) {}

  async run(job: RunJob): Promise<void> {
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    await this.deps.store.markRunning(job.runId, startedAt)

    const runDir = join(this.deps.runsDir, job.runId)
    let context: BrowserContext | undefined
    let status: 'passed' | 'failed' = 'passed'
    let data: unknown = null
    let error: { message: string; stack?: string } | null = null
    let steps: RunResult['steps'] = []
    let artifacts: Artifact[] = []

    try {
      context = await this.deps.provider.acquireContext({ baseURL: this.deps.baseURL })
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
      const page = await context.newPage()
      const sctx = new ApiScenarioContext(page, this.deps.baseURL, runDir, job.runId)

      try {
        const raw = await withTimeout(job.scenario.run(sctx, job.params), this.deps.timeoutMs)
        const parsed = job.scenario.result.safeParse(raw)
        if (parsed.success) {
          data = parsed.data
        } else {
          status = 'failed'
          error = { message: `Result did not match schema: ${parsed.error.message}` }
        }
      } catch (e) {
        status = 'failed'
        error = { message: errMessage(e), stack: errStack(e) }
        try {
          await page.screenshot({ path: join(runDir, 'failure.png'), fullPage: true })
          sctx.artifacts.push({ kind: 'screenshot', name: 'failure.png', url: `/runs/${job.runId}/artifacts/failure.png` })
        } catch {
          // スクリーンショット失敗は握りつぶす（元のエラーを優先）
        }
      } finally {
        if (status === 'failed') {
          await context.tracing.stop({ path: join(runDir, 'trace.zip') })
          sctx.artifacts.push({ kind: 'trace', name: 'trace.zip', url: `/runs/${job.runId}/artifacts/trace.zip` })
        } else {
          await context.tracing.stop()
        }
      }

      steps = sctx.steps
      artifacts = sctx.artifacts
    } catch (e) {
      // context取得やtracing開始の失敗
      status = 'failed'
      error = { message: errMessage(e), stack: errStack(e) }
    } finally {
      if (context) {
        try {
          await context.close()
        } catch {
          // ignore
        }
      }
    }

    const finishedAt = new Date().toISOString()
    const result: RunResult = {
      runId: job.runId,
      scenarioId: job.scenario.id,
      status,
      params: job.params,
      queuedAt: job.queuedAt,
      startedAt,
      finishedAt,
      durationMs: Date.now() - startMs,
      steps,
      data: status === 'passed' ? data : null,
      error,
      artifacts,
    }
    await this.deps.store.finish(job.runId, result)
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/runner.test.ts`
Expected: PASS（2件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/runner.ts src/core/run/runner.test.ts
git commit -m "feat: add Runner with tracing, artifacts and result validation"
```

---

## Task 10: RunService (`core/run/service.ts`)

**Files:**
- Create: `src/core/run/service.ts`
- Test: `src/core/run/service.test.ts`

**Interfaces:**
- Consumes: `Queue<RunJob>`, `RunStore`, `Scenario`, `newRunId`, `RunResult`
- Produces:
  - `class RunService { constructor(queue: Queue<RunJob>, store: RunStore); submit(scenario: AnyScenario, params: unknown): Promise<{ ok: true; runId: string } | { ok: false }>; getResult(runId: string): Promise<RunResult | undefined> }`
  - `submit`: キューに空きが無ければ `{ ok: false }`。空きがあれば `newRunId()` → `store.create()`（`meta.json` 書き込み）→ `queue.enqueue()` の順（worker が `markRunning` で見つけられるよう create を先に await する）。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/run/service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { Queue } from './queue.js'
import { FileRunStore } from './store.js'
import { RunService } from './service.js'
import { defineScenario } from '../scenario.js'
import type { RunJob } from './types.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'svc-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const scenario = defineScenario({
  id: 'noop', summary: '', tags: [], params: z.object({}), result: z.object({}),
  async run() { return {} },
})

describe('RunService', () => {
  it('creates meta and enqueues on submit', async () => {
    const store = new FileRunStore(dir)
    const seen: string[] = []
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 10 }, async (job) => {
      seen.push(job.runId)
    })
    const service = new RunService(queue, store)
    const r = await service.submit(scenario, {})
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(await store.get(r.runId)).toBeDefined()
      await queue.drain()
      expect(seen).toContain(r.runId)
    }
  })

  it('returns ok:false when queue has no capacity', async () => {
    const store = new FileRunStore(dir)
    const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 1 }, async () => {
      await new Promise(() => {}) // 走り続ける
    })
    const service = new RunService(queue, store)
    await service.submit(scenario, {}) // running
    await service.submit(scenario, {}) // waiting (maxQueue=1)
    const third = await service.submit(scenario, {})
    expect(third.ok).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/service.test.ts`
Expected: FAIL（`service.js` / `RunService` 未定義）。

- [ ] **Step 3: `core/run/service.ts` を実装**

Create `src/core/run/service.ts`:

```ts
import type { AnyScenario } from '../scenario.js'
import type { Queue } from './queue.js'
import type { RunStore } from './store.js'
import type { RunJob, RunResult } from './types.js'
import { newRunId } from './id.js'

export class RunService {
  constructor(
    private readonly queue: Queue<RunJob>,
    private readonly store: RunStore,
  ) {}

  async submit(scenario: AnyScenario, params: unknown): Promise<{ ok: true; runId: string } | { ok: false }> {
    if (!this.queue.hasCapacity()) return { ok: false }
    const runId = newRunId()
    const queuedAt = new Date().toISOString()
    await this.store.create(runId, scenario.id, params, queuedAt)
    const accepted = this.queue.enqueue({ runId, scenario, params, queuedAt })
    if (!accepted) return { ok: false }
    return { ok: true, runId }
  }

  async getResult(runId: string): Promise<RunResult | undefined> {
    return this.store.get(runId)
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/service.test.ts`
Expected: PASS（2件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/service.ts src/core/run/service.test.ts
git commit -m "feat: add RunService bridging routes, queue and store"
```

---

## Task 11: 保持期間の掃除 (`core/run/retention.ts`)

**Files:**
- Create: `src/core/run/retention.ts`
- Test: `src/core/run/retention.test.ts`

**Interfaces:**
- Consumes: なし（`runsDir` と保持数）
- Produces:
  - `function pruneRuns(runsDir: string, keep: number): Promise<string[]>` — ディレクトリ名（ULID）を降順ソートし、新しい方から `keep` 件を残して古いディレクトリを削除。削除したディレクトリ名の配列を返す。`runsDir` が存在しなければ何もしない。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/run/retention.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneRuns } from './retention.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'ret-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

describe('pruneRuns', () => {
  it('keeps the newest N run dirs and deletes older ones', async () => {
    // ULID は先頭がタイムスタンプなので、この昇順名は生成順に対応する
    const ids = ['01A', '01B', '01C', '01D', '01E']
    for (const id of ids) {
      await mkdir(join(dir, id), { recursive: true })
      await writeFile(join(dir, id, 'result.json'), '{}')
    }
    const deleted = await pruneRuns(dir, 2)
    const remaining = (await readdir(dir)).sort()
    expect(remaining).toEqual(['01D', '01E'])
    expect(deleted.sort()).toEqual(['01A', '01B', '01C'])
  })

  it('does nothing when runsDir is missing', async () => {
    const deleted = await pruneRuns(join(dir, 'nonexistent'), 5)
    expect(deleted).toEqual([])
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/run/retention.test.ts`
Expected: FAIL（`retention.js` / `pruneRuns` 未定義）。

- [ ] **Step 3: `core/run/retention.ts` を実装**

Create `src/core/run/retention.ts`:

```ts
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function pruneRuns(runsDir: string, keep: number): Promise<string[]> {
  let entries: string[]
  try {
    const dirents = await readdir(runsDir, { withFileTypes: true })
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }

  // ULID は生成順 = 辞書順。降順に並べて先頭 keep 件を残す。
  const sorted = entries.sort().reverse()
  const toDelete = sorted.slice(keep)
  for (const name of toDelete) {
    await rm(join(runsDir, name), { recursive: true, force: true })
  }
  return toDelete
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/run/retention.test.ts`
Expected: PASS（2件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/run/retention.ts src/core/run/retention.test.ts
git commit -m "feat: add startup run-directory retention pruning"
```

---

## Task 12: HTTP スキーマ (`core/http/schemas.ts`)

**Files:**
- Create: `src/core/http/schemas.ts`
- Test: `src/core/http/schemas.test.ts`

**Interfaces:**
- Consumes: `z` from `@hono/zod-openapi`
- Produces:
  - `const stepResultSchema`, `const artifactSchema`, `const runStatusSchema`, `const acceptedSchema`, `const errorSchema`, `const scenarioSummarySchema`
  - `function runResultSchema(resultSchema: z.ZodType): z.ZodType` — `data` が `resultSchema.nullable()` になる RunResult スキーマ。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/http/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { z } from '@hono/zod-openapi'
import { runResultSchema, acceptedSchema } from './schemas.js'

describe('schemas', () => {
  it('runResultSchema embeds the result schema in data and allows null', () => {
    const schema = runResultSchema(z.object({ userName: z.string() }))
    const ok = schema.safeParse({
      runId: 'R1', scenarioId: 'login', status: 'passed', params: {},
      queuedAt: 't', startedAt: 't', finishedAt: 't', durationMs: 1,
      steps: [], data: { userName: 'x' }, error: null, artifacts: [],
    })
    expect(ok.success).toBe(true)
    const nullData = schema.safeParse({
      runId: 'R1', scenarioId: 'login', status: 'failed', params: {},
      queuedAt: 't', startedAt: null, finishedAt: null, durationMs: null,
      steps: [], data: null, error: { message: 'x' }, artifacts: [],
    })
    expect(nullData.success).toBe(true)
  })

  it('acceptedSchema requires queued status', () => {
    expect(acceptedSchema.safeParse({ runId: 'R1', status: 'queued' }).success).toBe(true)
    expect(acceptedSchema.safeParse({ runId: 'R1', status: 'running' }).success).toBe(false)
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run src/core/http/schemas.test.ts`
Expected: FAIL（`schemas.js` 未定義）。

- [ ] **Step 3: `core/http/schemas.ts` を実装**

Create `src/core/http/schemas.ts`:

```ts
import { z } from '@hono/zod-openapi'

export const runStatusSchema = z.enum(['queued', 'running', 'passed', 'failed', 'interrupted'])

export const stepResultSchema = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed']),
  durationMs: z.number(),
  error: z.object({ message: z.string() }).optional(),
})

export const artifactSchema = z.object({
  kind: z.enum(['screenshot', 'trace']),
  name: z.string(),
  url: z.string(),
})

export const acceptedSchema = z.object({
  runId: z.string(),
  status: z.literal('queued'),
})

export const errorSchema = z.object({
  error: z.object({ message: z.string() }),
})

export const scenarioSummarySchema = z.object({
  id: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
})

export function runResultSchema(resultSchema: z.ZodType) {
  return z.object({
    runId: z.string(),
    scenarioId: z.string(),
    status: runStatusSchema,
    params: z.unknown(),
    queuedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    steps: z.array(stepResultSchema),
    data: resultSchema.nullable(),
    error: z.object({ message: z.string(), stack: z.string().optional() }).nullable(),
    artifacts: z.array(artifactSchema),
  })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/http/schemas.test.ts`
Expected: PASS（2件）。

- [ ] **Step 5: Commit**

```bash
git add src/core/http/schemas.ts src/core/http/schemas.test.ts
git commit -m "feat: add openapi schemas for run results and errors"
```

---

## Task 13: HTTP ルートとアプリ組み立て (`core/http/`)

**Files:**
- Create: `src/core/http/routes/health.ts`
- Create: `src/core/http/routes/scenarios.ts`
- Create: `src/core/http/routes/artifacts.ts`
- Create: `src/core/http/app.ts`
- Test: `src/core/http/app.test.ts`

**Interfaces:**
- Consumes: `OpenAPIHono`, `createRoute`, `z` (`@hono/zod-openapi`), `swaggerUI` (`@hono/swagger-ui`), `RunService`, `AnyScenario`, `Config`, schemas (Task 12)
- Produces:
  - `interface AppDeps { scenarios: AnyScenario[]; service: RunService; runsDir: string }`
  - `function createApp(deps: AppDeps): OpenAPIHono` — 以下を登録:
    - `GET /health` → `200 { status: 'ok' }`
    - `GET /scenarios` → `200` サマリ配列
    - シナリオごと `POST /scenarios/{id}/runs` → `202 { runId, status }` / `503`
    - シナリオごと `GET /scenarios/{id}/runs/{runId}` → `200` RunResult / `404`
    - `GET /runs/{runId}/artifacts/{name}` → `200` バイナリ / `404`
    - `GET /doc`（OpenAPI JSON）, `GET /ui`（Swagger UI）
    - `defaultHook` でバリデーション失敗を `400`。

- [ ] **Step 1: `core/http/routes/health.ts` を書く**

Create `src/core/http/routes/health.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'

export function registerHealthRoute(app: OpenAPIHono): void {
  const route = createRoute({
    method: 'get',
    path: '/health',
    responses: {
      200: {
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
        description: 'Health check',
      },
    },
  })
  app.openapi(route, (c) => c.json({ status: 'ok' as const }, 200))
}
```

- [ ] **Step 2: `core/http/routes/scenarios.ts` を書く**

Create `src/core/http/routes/scenarios.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { AnyScenario } from '../../scenario.js'
import type { RunService } from '../../run/service.js'
import { runResultSchema, acceptedSchema, errorSchema, scenarioSummarySchema } from '../schemas.js'

export function registerScenarioRoutes(app: OpenAPIHono, scenarios: AnyScenario[], service: RunService): void {
  const listRoute = createRoute({
    method: 'get',
    path: '/scenarios',
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(scenarioSummarySchema) } },
        description: 'Scenario catalog',
      },
    },
  })
  app.openapi(listRoute, (c) =>
    c.json(scenarios.map((s) => ({ id: s.id, summary: s.summary, tags: s.tags })), 200),
  )

  for (const scenario of scenarios) {
    const postRoute = createRoute({
      method: 'post',
      path: `/scenarios/${scenario.id}/runs`,
      tags: [scenario.id],
      request: {
        body: { content: { 'application/json': { schema: scenario.params } }, required: true },
      },
      responses: {
        202: { content: { 'application/json': { schema: acceptedSchema } }, description: 'Run accepted' },
        503: { content: { 'application/json': { schema: errorSchema } }, description: 'Queue full' },
      },
    })
    app.openapi(postRoute, async (c) => {
      const params = c.req.valid('json')
      const result = await service.submit(scenario, params)
      if (!result.ok) return c.json({ error: { message: 'Queue is full' } }, 503)
      return c.json({ runId: result.runId, status: 'queued' as const }, 202)
    })

    const getRoute = createRoute({
      method: 'get',
      path: `/scenarios/${scenario.id}/runs/{runId}`,
      tags: [scenario.id],
      request: { params: z.object({ runId: z.string() }) },
      responses: {
        200: { content: { 'application/json': { schema: runResultSchema(scenario.result) } }, description: 'Run result' },
        404: { content: { 'application/json': { schema: errorSchema } }, description: 'Not found' },
      },
    })
    app.openapi(getRoute, async (c) => {
      const { runId } = c.req.valid('param')
      const run = await service.getResult(runId)
      if (!run || run.scenarioId !== scenario.id) {
        return c.json({ error: { message: 'Run not found' } }, 404)
      }
      return c.json(run, 200)
    })
  }
}
```

- [ ] **Step 3: `core/http/routes/artifacts.ts` を書く**

Create `src/core/http/routes/artifacts.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi'
import type { RunService } from '../../run/service.js'
import { errorSchema } from '../schemas.js'

function contentTypeFor(name: string): string {
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.zip')) return 'application/zip'
  return 'application/octet-stream'
}

export function registerArtifactRoute(app: OpenAPIHono, service: RunService, runsDir: string): void {
  const route = createRoute({
    method: 'get',
    path: '/runs/{runId}/artifacts/{name}',
    request: { params: z.object({ runId: z.string(), name: z.string() }) },
    responses: {
      200: {
        content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
        description: 'Artifact file',
      },
      404: { content: { 'application/json': { schema: errorSchema } }, description: 'Not found' },
    },
  })
  app.openapi(route, async (c) => {
    const { runId, name } = c.req.valid('param')
    const run = await service.getResult(runId)
    if (!run) return c.json({ error: { message: 'Run not found' } }, 404)
    // result.json の artifacts[] に載っている名前だけを配信する（パストラバーサル防止）
    const artifact = run.artifacts.find((a) => a.name === name)
    if (!artifact) return c.json({ error: { message: 'Artifact not found' } }, 404)
    const buffer = await readFile(join(runsDir, runId, name))
    return c.newResponse(buffer, 200, { 'Content-Type': contentTypeFor(name) })
  })
}
```

- [ ] **Step 4: `core/http/app.ts` を書く**

Create `src/core/http/app.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import type { AnyScenario } from '../scenario.js'
import type { RunService } from '../run/service.js'
import { registerHealthRoute } from './routes/health.js'
import { registerScenarioRoutes } from './routes/scenarios.js'
import { registerArtifactRoute } from './routes/artifacts.js'

export interface AppDeps {
  scenarios: AnyScenario[]
  service: RunService
  runsDir: string
}

export function createApp(deps: AppDeps): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: { message: 'Invalid request' } }, 400)
      }
    },
  })

  registerHealthRoute(app)
  registerScenarioRoutes(app, deps.scenarios, deps.service)
  registerArtifactRoute(app, deps.service, deps.runsDir)

  app.doc('/doc', {
    openapi: '3.0.0',
    info: { title: 'Playwright E2E API', version: '1.0.0' },
  })
  app.get('/ui', swaggerUI({ url: '/doc' }))

  return app
}
```

- [ ] **Step 5: 失敗するテストを書く**（`app.request()` でルートを直接叩く。ブラウザは起動しない — worker を差し替えずに store だけ操作して GET を検証し、POST は fake queue で受理を確認する）

Create `src/core/http/app.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from '@hono/zod-openapi'
import { createApp } from './app.js'
import { defineScenario } from '../scenario.js'
import { Queue } from '../run/queue.js'
import { FileRunStore } from '../run/store.js'
import { RunService } from '../run/service.js'
import type { RunJob } from '../run/types.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'app-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

const loginScenario = defineScenario({
  id: 'login',
  summary: 'log in',
  tags: ['auth'],
  params: z.object({ email: z.email(), password: z.string() }),
  result: z.object({ userName: z.string() }),
  async run() { return { userName: 'x' } },
})

function makeApp() {
  const store = new FileRunStore(dir)
  // worker は何もしない（ジョブを running のまま放置）。POST受理と store 経由のGETを検証する。
  const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 10 }, async () => {})
  const service = new RunService(queue, store)
  const app = createApp({ scenarios: [loginScenario], service, runsDir: dir })
  return { app, store, service }
}

describe('createApp', () => {
  it('lists scenarios', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'login', summary: 'log in', tags: ['auth'] }])
  })

  it('rejects invalid POST body with 400', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid POST with 202 and a runId', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.status).toBe('queued')
    expect(typeof body.runId).toBe('string')
  })

  it('returns 404 for unknown runId', async () => {
    const { app } = makeApp()
    const res = await app.request('/scenarios/login/runs/UNKNOWN')
    expect(res.status).toBe(404)
  })

  it('exposes the scenario POST path in the OpenAPI doc', async () => {
    const { app } = makeApp()
    const res = await app.request('/doc')
    const doc = await res.json()
    expect(doc.paths['/scenarios/login/runs']).toBeDefined()
    expect(doc.paths['/scenarios/login/runs'].post.requestBody).toBeDefined()
  })

  it('serves health', async () => {
    const { app } = makeApp()
    const res = await app.request('/health')
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 6: テストが落ちることを確認**

Run: `npx vitest run src/core/http/app.test.ts`
Expected: FAIL（`app.js` などが無い、またはルート未実装）。もし `c.json(x, 202)` などで tsc 型エラーが出たら、`npm run build` の出力を見て、レスポンススキーマと返却値の型を一致させる（引き継ぎ書で `as any` 不要と確認済み。多くは返却オブジェクトのプロパティ欠落）。

- [ ] **Step 7: テストが通ることを確認**

Run: `npx vitest run src/core/http/app.test.ts && npm run build`
Expected: vitest PASS（6件）、`npm run build` もエラーなし。

- [ ] **Step 8: Commit**

```bash
git add src/core/http/
git commit -m "feat: add http app with dynamic scenario routes and openapi"
```

---

## Task 14: デモアプリ (`fixtures/demo-app/`)

**Files:**
- Create: `fixtures/demo-app/app.ts`
- Create: `fixtures/demo-app/server.ts`
- Test: `tests/demo-app.test.ts`

**Interfaces:**
- Consumes: `Hono`, `@hono/node-server`
- Produces:
  - `function createDemoApp(): Hono` — `GET /login`（フォーム）, `POST /login`（`user@example.com` / `correct-password` で成功→ `Set-Cookie` + 302 `/products`、失敗→ 200 でエラー表示）, `GET /products`（cookie 有効なら見出し「商品一覧」と `data-testid="user-name"` に「テストユーザー」、無効なら 302 `/login`）。
  - `server.ts` は `PORT`（既定 4321）で `createDemoApp()` を待ち受ける。
- **既知の資格情報**（テスト全体で使う）: email `user@example.com`, password `correct-password`, 表示名 `テストユーザー`。

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/demo-app.test.ts`:

```ts
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
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/demo-app.test.ts`
Expected: FAIL（`app.js` 未定義）。

- [ ] **Step 3: `fixtures/demo-app/app.ts` を実装**

Create `fixtures/demo-app/app.ts`:

```ts
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
```

- [ ] **Step 4: `fixtures/demo-app/server.ts` を実装**

Create `fixtures/demo-app/server.ts`:

```ts
import { serve } from '@hono/node-server'
import { createDemoApp } from './app.js'

const port = Number(process.env.PORT ?? 4321)
serve({ fetch: createDemoApp().fetch, port }, (info) => {
  console.log(`demo-app running on http://localhost:${info.port}`)
})
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run tests/demo-app.test.ts`
Expected: PASS（5件）。

- [ ] **Step 6: Commit**

```bash
git add fixtures/demo-app/ tests/demo-app.test.ts
git commit -m "feat: add demo-app fixture (login + products)"
```

---

## Task 15: Page Object とサンプルシナリオ (`src/pages/`, `src/scenarios/`)

**Files:**
- Create: `src/pages/login.page.ts`
- Create: `src/pages/product-list.page.ts`
- Create: `src/scenarios/login.ts`
- Create: `src/scenarios/index.ts`

**Interfaces:**
- Consumes: Playwright `Page`, `defineScenario` (`core/scenario.ts`), `z` (`@hono/zod-openapi`)
- Produces:
  - `class LoginPage { constructor(page: Page); goto(): Promise<void>; submit(email: string, password: string): Promise<void> }`
  - `class ProductListPage { constructor(page: Page); expectLoaded(): Promise<void>; userName(): Promise<string> }`
  - `const loginScenario` — params `{ email, password }`, result `{ userName }`。
  - `const scenarios: AnyScenario[]` — 明示登録（`src/scenarios/index.ts`）。
- **注意**: Page Object は `@playwright/test` の `expect` を使わない。待機は `locator.waitFor({ state: 'visible' })`。テストは Task 16 で行う（この Task はコードのみ、`npm run build` で型を検証）。

- [ ] **Step 1: `src/pages/login.page.ts` を書く**

Create `src/pages/login.page.ts`:

```ts
import type { Page } from 'playwright'

export class LoginPage {
  constructor(private readonly page: Page) {}

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
```

- [ ] **Step 2: `src/pages/product-list.page.ts` を書く**

Create `src/pages/product-list.page.ts`:

```ts
import type { Page } from 'playwright'

export class ProductListPage {
  constructor(private readonly page: Page) {}

  private readonly heading = () => this.page.getByRole('heading', { name: '商品一覧' })
  private readonly userName = () => this.page.getByTestId('user-name')

  async expectLoaded(): Promise<void> {
    // @playwright/test の expect は使わない。可視化を待機する。
    await this.heading().waitFor({ state: 'visible' })
  }

  async userName(): Promise<string> {
    const text = await this.userName().textContent()
    return text ?? ''
  }
}
```

> 注: `userName` メソッド名とプライベート `userName` ロケータ名が衝突する。プライベート側を `userNameLocator` にリネームすること:

Create（衝突を避けた最終形）`src/pages/product-list.page.ts`:

```ts
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
```

- [ ] **Step 3: `src/scenarios/login.ts` を書く**

Create `src/scenarios/login.ts`:

```ts
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
    const login = new LoginPage(ctx.page)
    await ctx.step('ログイン画面を開く', () => login.goto())
    await ctx.step('資格情報を送信', () => login.submit(params.email, params.password))

    const list = new ProductListPage(ctx.page)
    await ctx.step('商品一覧の表示を確認', () => list.expectLoaded())
    await ctx.screenshot('product-list')

    return { userName: await list.userName() }
  },
})
```

- [ ] **Step 4: `src/scenarios/index.ts` を書く**

Create `src/scenarios/index.ts`:

```ts
import type { AnyScenario } from '../core/scenario.js'
import { loginScenario } from './login.js'

export const scenarios: AnyScenario[] = [loginScenario]
```

- [ ] **Step 5: 型が通ることを確認**

Run: `npm run build`
Expected: エラーなし。

- [ ] **Step 6: Commit**

```bash
git add src/pages/ src/scenarios/
git commit -m "feat: add login page objects and sample scenario"
```

---

## Task 16: テスト実行ヘルパと `@playwright/test` spec (`core/testing/`, `tests/login.spec.ts`)

**Files:**
- Create: `src/core/testing/context.ts`
- Create: `src/core/testing/run-in-test.ts`
- Create: `tests/login.spec.ts`

**Interfaces:**
- Consumes: `@playwright/test` (`test`, `Page`, `TestInfo`), `ScenarioContext`, `Scenario`, `z`
- Produces:
  - `class TestScenarioContext implements ScenarioContext` — `constructor(page: Page, baseURL: string, testInfo: TestInfo)`。`step` は `test.step` に委譲、`screenshot` は `testInfo.attach`。
  - `function runScenarioInTest<P, R>(scenario: Scenario<P, R>, params: z.infer<P>, opts: { page: Page; testInfo: TestInfo; baseURL: string }): Promise<z.infer<R>>` — params を検証し `run` を呼び、result を検証して返す。

- [ ] **Step 1: `src/core/testing/context.ts` を書く**

Create `src/core/testing/context.ts`:

```ts
import { test, type Page, type TestInfo } from '@playwright/test'
import type { ScenarioContext } from '../scenario.js'

export class TestScenarioContext implements ScenarioContext {
  private screenshotIndex = 0

  constructor(
    readonly page: Page,
    readonly baseURL: string,
    private readonly testInfo: TestInfo,
  ) {}

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return test.step(name, fn)
  }

  async screenshot(name: string): Promise<void> {
    this.screenshotIndex++
    const body = await this.page.screenshot({ fullPage: true })
    await this.testInfo.attach(`${String(this.screenshotIndex).padStart(2, '0')}-${name}`, {
      body,
      contentType: 'image/png',
    })
  }
}
```

- [ ] **Step 2: `src/core/testing/run-in-test.ts` を書く**

Create `src/core/testing/run-in-test.ts`:

```ts
import type { Page, TestInfo } from '@playwright/test'
import type { z } from 'zod'
import type { Scenario } from '../scenario.js'
import { TestScenarioContext } from './context.js'

export async function runScenarioInTest<P extends z.ZodType, R extends z.ZodType>(
  scenario: Scenario<P, R>,
  params: z.infer<P>,
  opts: { page: Page; testInfo: TestInfo; baseURL: string },
): Promise<z.infer<R>> {
  const parsedParams = scenario.params.parse(params) as z.infer<P>
  const ctx = new TestScenarioContext(opts.page, opts.baseURL, opts.testInfo)
  const raw = await scenario.run(ctx, parsedParams)
  return scenario.result.parse(raw) as z.infer<R>
}
```

- [ ] **Step 3: `tests/login.spec.ts` を書く**

Create `tests/login.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { loginScenario } from '../src/scenarios/login.js'
import { runScenarioInTest } from '../src/core/testing/run-in-test.js'

test('login scenario succeeds against demo-app', async ({ page, baseURL }, testInfo) => {
  const result = await runScenarioInTest(
    loginScenario,
    { email: 'user@example.com', password: 'correct-password' },
    { page, testInfo, baseURL: baseURL ?? '' },
  )
  expect(result.userName).toBe('テストユーザー')
})
```

- [ ] **Step 4: テストが通ることを確認**（webServer が demo-app を自動起動する）

Run: `npx playwright test tests/login.spec.ts`
Expected: PASS（1件）。`playwright.config.ts` の `webServer` が `fixtures/demo-app/server.ts` を PORT 4321 で起動し、`baseURL` がそこを指す。

- [ ] **Step 5: Commit**

```bash
git add src/core/testing/ tests/login.spec.ts
git commit -m "feat: add @playwright/test bridge and login spec"
```

---

## Task 17: エントリポイント (`src/index.ts`)

**Files:**
- Modify: `src/index.ts`（スケルトンを全置換）
- Test: 手動起動 + curl（下記）

**Interfaces:**
- Consumes: `loadConfig`, `createBrowserProvider`, `FileRunStore`, `Queue`, `Runner`, `RunService`, `createApp`, `pruneRuns`, `scenarios`, `@hono/node-server` `serve`
- Produces: `runs/` 掃除 → provider 初期化 → queue(worker=runner.run) → Hono サーバ起動 → `SIGTERM`/`SIGINT` でグレースフルシャットダウン（新規受付停止 → `queue.drain()` → `provider.close()`）。

- [ ] **Step 1: `src/index.ts` を全置換**

Replace `src/index.ts` with:

```ts
import { serve } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import { createBrowserProvider } from './core/browser/provider.js'
import { FileRunStore } from './core/run/store.js'
import { Queue } from './core/run/queue.js'
import { Runner } from './core/run/runner.js'
import { RunService } from './core/run/service.js'
import { pruneRuns } from './core/run/retention.js'
import { createApp } from './core/http/app.js'
import { scenarios } from './scenarios/index.js'
import { buildRegistry } from './core/registry.js'
import type { RunJob } from './core/run/types.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // 起動時に1度だけ保持期間の掃除
  await pruneRuns(config.runsDir, config.runRetention)

  // ID重複を起動時に検出（例外で落とす）
  buildRegistry(scenarios)

  const provider = createBrowserProvider(config)
  const store = new FileRunStore(config.runsDir)
  const runner = new Runner({
    provider,
    store,
    baseURL: config.baseURL,
    runsDir: config.runsDir,
    timeoutMs: config.scenarioTimeoutMs,
  })
  const queue = new Queue<RunJob>(
    { maxConcurrency: config.maxConcurrency, maxQueue: config.maxQueue },
    (job) => runner.run(job),
  )
  const service = new RunService(queue, store)
  const app = createApp({ scenarios, service, runsDir: config.runsDir })

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Playwright E2E API listening on http://localhost:${info.port}`)
    console.log(`  Swagger UI: http://localhost:${info.port}/ui`)
  })

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`${signal} received, shutting down...`)
    server.close()
    const drainWithTimeout = Promise.race([
      queue.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, 30000)),
    ])
    await drainWithTimeout
    await provider.close()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    console.error('uncaughtException', err)
    process.exit(1)
  })
  process.on('unhandledRejection', (err) => {
    console.error('unhandledRejection', err)
    process.exit(1)
  })
}

void main()
```

- [ ] **Step 2: ビルドが通ることを確認**

Run: `npm run build`
Expected: エラーなし。`dist/index.js` が生成され、`dist/` に `tests/` や `fixtures/` が含まれないことを確認（`ls dist` にそれらが無い）。

- [ ] **Step 3: 手動でサーバを起動して疎通確認**

Run（別プロセスで demo-app を起動してから API を起動）:
```bash
PORT=4321 npx tsx fixtures/demo-app/server.ts &
DEMO_PID=$!
BASE_URL=http://localhost:4321 PORT=3000 npm run dev &
API_PID=$!
sleep 3
curl -s http://localhost:3000/health
echo
RUNID=$(curl -s -X POST http://localhost:3000/scenarios/login/runs \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"correct-password"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).runId))")
echo "runId=$RUNID"
sleep 5
curl -s http://localhost:3000/scenarios/login/runs/$RUNID
echo
kill $API_PID $DEMO_PID
```
Expected: `/health` が `{"status":"ok"}`、最後の GET が `"status":"passed"` と `"data":{"userName":"テストユーザー"}` を含む。

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entrypoint with lifecycle and graceful shutdown"
```

---

## Task 18: 結合テスト (`tests/api.integration.test.ts`)

**Files:**
- Create: `tests/api.integration.test.ts`

**Interfaces:**
- Consumes: `createDemoApp`, `@hono/node-server` `serve`, `createApp`, `FileRunStore`, `Queue`, `Runner`, `RunService`, `createBrowserProvider`, `loginScenario`
- Produces: demo-app を実ポートで起動し、API アプリを in-process (`app.request`) で構築、実ブラウザで `POST → ポーリング → passed` と、誤パスワードで `failed` + `trace.zip`/`failure.png` を検証。

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/api.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { serve, type ServerType } from '@hono/node-server'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDemoApp } from '../fixtures/demo-app/app.js'
import { createApp } from '../src/core/http/app.js'
import { FileRunStore } from '../src/core/run/store.js'
import { Queue } from '../src/core/run/queue.js'
import { Runner } from '../src/core/run/runner.js'
import { RunService } from '../src/core/run/service.js'
import { createBrowserProvider } from '../src/core/browser/provider.js'
import { loginScenario } from '../src/scenarios/login.js'
import type { RunJob } from '../src/core/run/types.js'
import type { Hono } from 'hono'

const DEMO_PORT = 4399
let demoServer: ServerType
let runsDir: string
let app: Hono
let provider: ReturnType<typeof createBrowserProvider>

beforeAll(async () => {
  demoServer = serve({ fetch: createDemoApp().fetch, port: DEMO_PORT })
  runsDir = await mkdtemp(join(tmpdir(), 'integ-'))
  const baseURL = `http://localhost:${DEMO_PORT}`
  provider = createBrowserProvider({
    port: 0, baseURL, browser: 'chromium', headless: true,
    maxConcurrency: 1, maxQueue: 100, runsDir, runRetention: 50, scenarioTimeoutMs: 120000,
  })
  const store = new FileRunStore(runsDir)
  const runner = new Runner({ provider, store, baseURL, runsDir, timeoutMs: 120000 })
  const queue = new Queue<RunJob>({ maxConcurrency: 1, maxQueue: 100 }, (job) => runner.run(job))
  const service = new RunService(queue, store)
  app = createApp({ scenarios: [loginScenario], service, runsDir })
})

afterAll(async () => {
  await provider.close()
  demoServer.close()
  await rm(runsDir, { recursive: true, force: true })
})

async function poll(runId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const res = await app.request(`/scenarios/login/runs/${runId}`)
    const body = await res.json()
    if (body.status === 'passed' || body.status === 'failed') return body
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('run did not settle in time')
}

async function submit(password: string): Promise<string> {
  const res = await app.request('/scenarios/login/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password }),
  })
  expect(res.status).toBe(202)
  return (await res.json()).runId
}

describe('API integration', () => {
  it('runs the login scenario end-to-end and returns passed', async () => {
    const runId = await submit('correct-password')
    const body = await poll(runId)
    expect(body.status).toBe('passed')
    expect(body.data.userName).toBe('テストユーザー')
    expect(body.artifacts.some((a: any) => a.name === '01-product-list.png')).toBe(true)
  })

  it('returns failed with trace and failure screenshot on wrong password', async () => {
    const runId = await submit('wrong-password')
    const body = await poll(runId)
    expect(body.status).toBe('failed')
    const names = body.artifacts.map((a: any) => a.name)
    expect(names).toContain('trace.zip')
    expect(names).toContain('failure.png')
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npx vitest run tests/api.integration.test.ts`
Expected: 最初は demo-app のポート衝突や未実装がなければ通るはず。もし型エラー（`createBrowserProvider` に渡す `Config` の欠落プロパティ）が出たら、`Config` の全フィールドを埋める。

- [ ] **Step 3: テストが通ることを確認**

Run: `npx vitest run tests/api.integration.test.ts`
Expected: PASS（2件）。失敗系は誤パスワードで demo-app が `/products` に遷移しないため、`ProductListPage.expectLoaded()` の `waitFor` がタイムアウトして `failed` になる。`waitFor` の既定タイムアウトは30秒で `SCENARIO_TIMEOUT_MS`(120s) 内に収まる。テストが遅い場合は demo-app のログイン失敗時に短時間で確実に商品一覧が出ないことだけ担保されていればよい。

- [ ] **Step 4: 全テストを通す**

Run: `npm test`
Expected: すべての `*.test.ts` が PASS。
Run: `npx playwright test`
Expected: `tests/login.spec.ts` が PASS。

- [ ] **Step 5: Commit**

```bash
git add tests/api.integration.test.ts
git commit -m "test: add end-to-end API integration tests (pass and fail)"
```

---

## Task 19: README

**Files:**
- Modify: `README.md`（`hono create` の生成物を上書き）

**Interfaces:**
- Consumes: なし
- Produces: ひな形の使い方、環境変数一覧、コピー先で書き換える場所（`src/pages/` `src/scenarios/` `tests/` を書き換え、`fixtures/demo-app/` を削除）。

- [ ] **Step 1: `README.md` を書く**

Replace `README.md` with:

````markdown
# Playwright E2E API サーバ ひな形

HTTPリクエストを受けて Playwright のシナリオを実行し、結果を返す API サーバのひな形。
このリポジトリをコピーして、複数システムの E2E テスト基盤として使う。

同一のシナリオコードが、API サーバ経由でも `@playwright/test` からでも実行できる。

## クイックスタート

```bash
npm install
npx playwright install chromium

# demo-app を起動（別ターミナル）
PORT=4321 npx tsx fixtures/demo-app/server.ts

# API サーバを起動
BASE_URL=http://localhost:4321 npm run dev
```

- Swagger UI: http://localhost:3000/ui
- OpenAPI JSON: http://localhost:3000/doc

```bash
# シナリオを実行
curl -X POST http://localhost:3000/scenarios/login/runs \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"correct-password"}'
# → { "runId": "01J...", "status": "queued" }

# 結果をポーリング
curl http://localhost:3000/scenarios/login/runs/01J...
```

## API

| メソッド・パス | 説明 |
|---|---|
| `GET /scenarios` | シナリオ一覧（id, summary, tags） |
| `POST /scenarios/{id}/runs` | 実行を受理し `202 { runId }` |
| `GET /scenarios/{id}/runs/{runId}` | 実行結果（`data` は型付き） |
| `GET /runs/{runId}/artifacts/{name}` | スクリーンショット/trace の配信 |
| `GET /doc` / `GET /ui` | OpenAPI JSON / Swagger UI |
| `GET /health` | ヘルスチェック |

シナリオを1つ追加すると、OpenAPI ドキュメントにそのパスと入力フォームが自動で増える。

## 環境変数

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | `3000` | API サーバのポート |
| `BASE_URL` | (必須) | テスト対象のベースURL |
| `BROWSER` | `chromium` | `chromium` \| `firefox` \| `webkit` |
| `HEADLESS` | `true` | ヘッドレス実行 |
| `BROWSER_WS_ENDPOINT` | (未設定) | 設定時は外部ブラウザサーバへ接続 |
| `MAX_CONCURRENCY` | `1` | 同時実行シナリオ数 |
| `MAX_QUEUE` | `100` | 待機ジョブ上限（超過で `503`） |
| `RUNS_DIR` | `./runs` | 実行結果の保存先 |
| `RUN_RETENTION` | `50` | 保持する実行ディレクトリ数 |
| `SCENARIO_TIMEOUT_MS` | `120000` | 1シナリオの実行時間上限 |

## テスト

```bash
npm test            # Vitest（core のユニット + 結合）
npx playwright test # @playwright/test 経由のシナリオ実行
```

## 新しいシステムへ展開する

`src/core/` は触らない骨格。以下を書き換える:

1. `src/pages/` — 対象システムの Page Object を書く
2. `src/scenarios/` — シナリオを定義し `src/scenarios/index.ts` に登録
3. `tests/` — `@playwright/test` の spec を書く
4. `fixtures/demo-app/` — **削除する**（同梱のデモ対象アプリ）
5. `BASE_URL` を対象システムに向ける

## 意図的に含めないもの

認証、秘匿パラメータのマスク、リトライ、スケジューリング、動画記録。
`params`（パスワード含む）は `runs/{runId}/result.json` に平文で残るため、
共有環境では `runs/` のアクセス権を絞ること。
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README for the E2E API server template"
```

---

## Self-Review

**1. Spec coverage:**

- API エンドポイント（`/scenarios`, POST/GET runs, artifacts, `/doc`, `/ui`, `/health`）→ Task 13。✓
- シナリオごとの個別パス生成、OpenAPI がカタログ → Task 13（`registerScenarioRoutes` ループ）。✓
- 結果取得をシナリオ配下に置く、runId 不一致で 404 → Task 13 GET ハンドラ。✓
- シナリオ失敗は 200 + `status: failed` → Task 9 runner + Task 18 で検証。✓
- 400/404/503 の割り当て → Task 13（defaultHook 400、404、503）。✓
- 非同期ジョブ + インメモリ + FS、`RunStore` → Task 5。✓
- 再起動で `interrupted` → Task 5（meta.json 経由）。✓ 微修正3（meta.json を create で書く）反映。✓
- キューと同時実行制御（`MAX_CONCURRENCY`/`MAX_QUEUE`）→ Task 6。✓
- `BrowserProvider` 抽象、Local/Remote、`BROWSER_WS_ENDPOINT` → Task 7。✓
- ブラウザ1つ + コンテキストN → Task 7（`ensureBrowser` 単一 + `newContext`）。✓
- `defineScenario`、`ScenarioContext` の4メソッド → Task 3, 8。✓
- Page Object Model、`expect` 不使用 → Task 15（`waitFor`）。✓
- レジストリ明示列挙、ID重複検出 → Task 3 + Task 17（起動時 `buildRegistry`）。✓
- 結果オブジェクト構造 → Task 4/9。微修正2（`startedAt: string|null` + `queuedAt`、`durationMs = finishedAt - startedAt`）反映。✓
- 明示スクリーンショット常時保存、フラット配置 → Task 8。微修正1（`screenshots/` サブディレクトリ廃止）反映。✓
- trace は失敗時のみ、動画なし → Task 9。✓
- artifact 配信は記録名のみ（パストラバーサル防止）→ Task 13 artifacts。✓
- 保持期間（起動時1回、ULIDソート）→ Task 11 + Task 17。✓
- config 環境変数 Zod 検証、`BASE_URL` 必須 → Task 2。✓
- ライフサイクル（起動順、実行手順の finally、グレースフルシャットダウン）→ Task 9 + Task 17。✓
- エラーハンドリング（defaultHook、runner 捕捉、タイムアウト、未捕捉例外で終了）→ Task 9, 13, 17。✓
- 2入口（API と `@playwright/test`）→ Task 16（`TestScenarioContext` + spec）+ Task 18。✓
- `fixtures/demo-app` 同梱でオフライン完結 → Task 14。✓
- ディレクトリ構造の core/システム固有境界 → File Structure セクション + 全タスク。✓
- README（展開手順）→ Task 19。✓

ギャップなし。

**2. Placeholder scan:** 各実装ステップに完全なコードを記載。「適切なエラー処理」等の曖昧表現なし。Task 15 の `product-list.page.ts` は命名衝突の注記付きで最終形コードを提示済み。

**3. Type consistency:**
- `RunResult` の形（`queuedAt`, `startedAt: string|null`, `durationMs: number|null`）が types.ts / store.ts / runner.ts / schemas.ts で一致。✓
- `RunJob { runId, scenario, params, queuedAt }` が types.ts / runner.ts / service.ts / queue の型引数で一致。✓
- `RunStore` シグネチャ（`create(runId, scenarioId, params, queuedAt)`, `markRunning(runId, startedAt)`, `finish(runId, result)`, `get(runId)`）が store.ts / runner.ts / service.ts で一致。✓
- `Queue<J>`（`hasCapacity`, `enqueue`, `drain`, `stats`）が queue.ts / service.ts / index.ts で一致。✓
- `BrowserProvider`（`acquireContext`, `close`）が provider/local/remote/runner/index で一致。✓
- `createBrowserProvider(config: Config)` が Task 7 と Task 18 のテストで同じ `Config` 形を要求。Task 18 は全フィールドを埋める（Step 2 の注記）。✓
- `ScenarioContext` の4メソッドが ApiScenarioContext / TestScenarioContext の両実装で一致。✓
- `ProductListPage.userName()` メソッドとロケータ名の衝突を Task 15 で解消済み（`userNameLocator`）。✓

一貫性の問題なし。

---

## 実装上の既知のリスク（実装者への注記）

- **`c.json(value, statusCode)` の型**: `@hono/zod-openapi` の `app.openapi()` はレスポンス schema と返却値の型一致を要求する。引き継ぎ書で `as any` なしに通ると確認済みだが、返却オブジェクトのプロパティ欠落で型エラーが出たら schema と実データを突き合わせる。`c.newResponse(buffer, 200, headers)` のバイナリ配信も型が通ることを確認済み。
- **`z` のインポート元**: OpenAPI に出すスキーマ（scenarios, http/schemas）は `@hono/zod-openapi` の `z`、純検証（config）は `zod` の `z`。型は互換だが `.openapi()` は前者だけに生える。
- **ブラウザ sandbox**: `chromium.launch()` で sandbox エラーが出たら `args: ['--no-sandbox']` を足す（Task 7 Step 5 の注記）。
- **`getByTestId`**: 既定の testId 属性は `data-testid`。demo-app の `<span data-testid="user-name">` と一致。Playwright 設定を変えている場合は `testIdAttribute` を確認。
- **`core/testing/` の `@playwright/test` 依存**: `src/index.ts` の実行時パスからは import されないため、サーバ実行時に `@playwright/test` は読み込まれない。`tsc` は `dist/core/testing/` を出力するが未使用。実行時依存の混入は無い（Global Constraints 準拠）。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-10-playwright-e2e-api-server.md`.**
