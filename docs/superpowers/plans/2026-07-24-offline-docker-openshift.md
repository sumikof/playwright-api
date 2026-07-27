# オフライン Docker / OpenShift 対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playwright E2E API サーバのひな形を、オフライン環境で Docker / rootless OpenShift 上で動かせるようにし、fork 運用の共通部分管理を確立する。

**Architecture:** 4フェーズ。①CDN 排除(Swagger UI 自前配信 + `BROWSER_LAUNCH_ARGS` + E2E 設定の env 駆動化)②Dockerfile(2ステージ・オフラインビルド)③OpenShift Kustomize(base + overlay、Route は opt-in)④テンプレート運用(`sync-upstream.sh` + README)。Phase 1 はコード+テスト、Phase 2〜4 は成果物ファイル+検証。

**Tech Stack:** TypeScript(ESM)、Hono(`@hono/zod-openapi`)、Playwright 1.61.1、Vitest、Kustomize、Docker。

**設計スペック:** `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md`(Codex 設計レビュー収束済み `08aa583`)。Dockerfile と deploy ツリーの逐語ブロックは spec §3・§4 にあるので、該当タスクはそれを参照する。

**作業ブランチ:** `feature/2-offline-docker-openshift`(Draft PR #3、Relates to #2)。成果物は同ブランチ・同 PR に追加。

## Global Constraints

- **言語**: コメント・ドキュメントは日本語(既存に合わせる)。
- **バージョン整合**: `playwright` / `@playwright/test` は npm 版とベースイメージタグを完全一致。`package.json` はキャレット(`^`)を外し **`1.61.1`** に固定。
- **オフライン validator 排除**: Swagger UI 初期化に **`validatorUrl: null`** を必須設定。
- **/ui 外部通信ゼロ(必須テスト)**: `/ui` をブラウザで実描画し外部ホストへの要求がゼロであることを検証するテストを Phase 1 完了条件に含める。
- **fork の test:e2e を汚さない**: デモ E2E spec は既定 `testDir` 外へ、`playwright.config.ts` は `BASE_URL` 駆動。
- **rootless**: Dockerfile は `USER` 固定なし、`chgrp -R 0 && chmod -R g=u`、`HOME=/tmp`。OpenShift は `runAsUser`/`fsGroup` を書かない。
- **Route は base に置かない**(overlay opt-in、TLS/認証前提)。
- **YAGNI**: npm prune・readOnlyRootFilesystem・水平スケール・CI/CD・firefox/webkit 動作保証はやらない。
- **検証コマンド**: `npm test`(vitest)、`npm run build`(tsc)、`npm run test:e2e`(playwright)。
- **サブエージェント**: 変更を伴う作業は同時 1(直列)。
- **環境リスク**: この devcontainer に npm レジストリ到達性/docker があるか未確認。`npm install`(新規依存)や `docker build` が不可なら、そのタスクはユーザーの npm/docker 環境での実施に切り替える(その旨を報告)。
- **コミット**: 各タスク末尾で1コミット。メッセージ末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。push は HTTPS(`git push https://github.com/sumikof/playwright-api.git feature/2-offline-docker-openshift:feature/2-offline-docker-openshift`)。

---

## Phase 1 — CDN 排除と E2E 設定

### Task 1: 依存の追加・削除とバージョン固定

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `swagger-ui-dist` が dependencies に存在、`@hono/swagger-ui` は不在、`playwright`/`@playwright/test` が `1.61.1` 固定。後続 Task 3 が `swagger-ui-dist` を、Task 4/5 が固定 Playwright を前提にする。

- [ ] **Step 1: package.json を編集**

- `dependencies` に `"swagger-ui-dist": "5.29.4"`(キャレットなし固定。実際に入る最新安定版があればそのバージョンに固定)を追加。
- `dependencies` から `"@hono/swagger-ui"` を削除。
- `"playwright": "^1.61.1"` → `"playwright": "1.61.1"`、`"@playwright/test": "^1.61.1"` → `"@playwright/test": "1.61.1"`。

- [ ] **Step 2: 依存をインストール(lockfile 更新)**

Run: `npm install`
Expected: 成功して `package-lock.json` が更新され、`node_modules/swagger-ui-dist` が存在する。
※ レジストリ到達不可で失敗した場合は BLOCKED として報告し、ユーザーの npm 環境での `npm install` + lockfile 更新に切り替える(spec の前提どおり node_modules は外部調達)。

- [ ] **Step 3: 確認**

Run: `node -e "require.resolve('swagger-ui-dist/swagger-ui-bundle.js'); console.log('ok')"` および `grep -c '@hono/swagger-ui' package.json`
Expected: `ok` / `0`

- [ ] **Step 4: コミット**

```bash
git add package.json package-lock.json
git commit -m "$(printf 'build: add swagger-ui-dist, drop @hono/swagger-ui, pin playwright 1.61.1\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `BROWSER_LAUNCH_ARGS` の追加

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/core/browser/local.ts`
- Modify: `src/core/browser/provider.ts`
- Test: `src/core/config.test.ts`, `src/core/browser/local.test.ts`

**Interfaces:**
- Produces: `Config.browserLaunchArgs: string[]`(既定 `[]`)。`LocalBrowserProvider` のコンストラクタ opts に `launchArgs: string[]` を追加し、`launch({ headless, args })` に渡す。`createBrowserProvider` が `config.browserLaunchArgs` を渡す。

- [ ] **Step 1: 失敗するテストを書く(config)**

`src/core/config.test.ts` に追加:

```typescript
it('parses BROWSER_LAUNCH_ARGS into an args array', () => {
  const cfg = loadConfig({ BASE_URL: 'http://x', BROWSER_LAUNCH_ARGS: '--no-sandbox --disable-gpu' })
  expect(cfg.browserLaunchArgs).toEqual(['--no-sandbox', '--disable-gpu'])
})

it('defaults BROWSER_LAUNCH_ARGS to an empty array', () => {
  const cfg = loadConfig({ BASE_URL: 'http://x' })
  expect(cfg.browserLaunchArgs).toEqual([])
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm test -- src/core/config.test.ts`
Expected: FAIL(`browserLaunchArgs` undefined)

- [ ] **Step 3: config.ts を実装**

- `envSchema` に `BROWSER_LAUNCH_ARGS: z.string().default('')` を追加。
- `Config` に `browserLaunchArgs: string[]` を追加。
- `loadConfig` の返り値に `browserLaunchArgs: e.BROWSER_LAUNCH_ARGS.split(' ').map(s => s.trim()).filter(Boolean)` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `npm test -- src/core/config.test.ts`
Expected: PASS

- [ ] **Step 5: local.ts / provider.ts を実装**

- `local.ts`: コンストラクタ opts を `{ browser; headless; launchArgs?: string[] }` にし、`launch({ headless: this.opts.headless, args: this.opts.launchArgs ?? [] })`。
- `provider.ts`: `new LocalBrowserProvider({ browser: config.browser, headless: config.headless, launchArgs: config.browserLaunchArgs })`。

- [ ] **Step 6: local のテストを追加(args 伝播)**

`src/core/browser/local.test.ts` に、`launchArgs` が `launch` に渡ることを検証するテストを追加(既存テストの launch 呼び出しを spy/確認する形。既存パターンに合わせる)。例:

```typescript
it('passes launchArgs to browser launch', async () => {
  const p = new LocalBrowserProvider({ browser: 'chromium', headless: true, launchArgs: ['--no-sandbox'] })
  const ctx = await p.acquireContext()   // 起動が成功すればOK。可能なら launch 引数を検証
  await ctx.close(); await p.close()
})
```

- [ ] **Step 7: 全テスト + ビルド**

Run: `npm test && npm run build`
Expected: PASS / clean

- [ ] **Step 8: コミット**

```bash
git add src/core/config.ts src/core/config.test.ts src/core/browser/local.ts src/core/browser/local.test.ts src/core/browser/provider.ts
git commit -m "$(printf 'feat: add BROWSER_LAUNCH_ARGS config threaded to browser launch\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Swagger UI 自前配信(validatorUrl: null、CDN 排除)

**Files:**
- Modify: `src/core/http/app.ts`
- Create: `src/core/http/routes/swagger-ui.ts`(自前 `/ui` + `/ui/assets/*` ハンドラ)
- Test: `src/core/http/app.test.ts`(または新規 `swagger-ui.test.ts`)

**Interfaces:**
- Consumes: `swagger-ui-dist`(Task 1)。
- Produces: `registerSwaggerUI(app)` を export。`app.ts` は `@hono/swagger-ui` を import せず、`app.get('/ui', …)` と `/ui/assets/:file` を自前ハンドラで登録。

- [ ] **Step 1: 失敗するテストを書く**

`src/core/http/app.test.ts` に追加(app は createApp で生成):

```typescript
it('serves /ui without any external host URL and disables the validator', async () => {
  const res = await app.request('/ui')
  const html = await res.text()
  expect(res.status).toBe(200)
  expect(html).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/) // 他ホスト URL 不在
  expect(html).toContain('validatorUrl') // 初期化に validatorUrl 指定
  expect(html).toMatch(/validatorUrl:\s*null/) // null で無効化
  expect(html).not.toContain('jsdelivr')
  expect(html).not.toContain('validator.swagger.io')
})

it('serves swagger-ui assets locally', async () => {
  const res = await app.request('/ui/assets/swagger-ui.css')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toContain('text/css')
})
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `npm test -- src/core/http/app.test.ts`
Expected: FAIL

- [ ] **Step 3: `swagger-ui.ts` を実装**

- `/ui`: 自前 HTML を返す。`<link rel="stylesheet" href="/ui/assets/swagger-ui.css">`、`<script src="/ui/assets/swagger-ui-bundle.js">`、`<script src="/ui/assets/swagger-ui-standalone-preset.js">` を参照。初期化スクリプトで:
  ```js
  window.ui = SwaggerUIBundle({
    url: '/doc',
    dom_id: '#swagger-ui',
    validatorUrl: null,            // オンライン validator を無効化(外部通信排除)
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  })
  ```
- `/ui/assets/:file`: `swagger-ui-dist` のパッケージディレクトリ(`path.dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'))`、ESM では `createRequire(import.meta.url)` を使用)から `swagger-ui.css` / `swagger-ui-bundle.js` / `swagger-ui-standalone-preset.js` のみをホワイトリスト配信(パストラバーサル防止)。content-type を拡張子から設定。

- [ ] **Step 4: `app.ts` を修正**

- `import { swaggerUI } from '@hono/swagger-ui'` を削除。
- `app.get('/ui', swaggerUI({ url: '/doc' }))` を削除し、`registerSwaggerUI(app)` の呼び出しに置換(`app.doc('/doc', …)` はそのまま)。

- [ ] **Step 5: テスト + ビルド**

Run: `npm test -- src/core/http/app.test.ts && npm run build`
Expected: PASS / clean

- [ ] **Step 6: コミット**

```bash
git add src/core/http/app.ts src/core/http/routes/swagger-ui.ts src/core/http/app.test.ts
git commit -m "$(printf 'feat: self-host Swagger UI assets with validatorUrl:null (offline)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: /ui 実描画で外部要求ゼロの必須テスト(Playwright)

**Files:**
- Create: `tests/ui-offline.spec.ts`(通常の testDir に置くが、この spec はテンプレート所有=API サーバ自身の検証。Task 5 のデモ spec 分離とは別物として残す)

**Interfaces:**
- Consumes: Task 3 の `/ui`。テストは API サーバをローカル起動し(`npm run dev` 相当をテスト内で spawn するか、`serve` を import して起動)、Playwright で `/ui` を開き、外部ホストへのリクエストが1件も無いことを検証。

- [ ] **Step 1: テストを書く**

`tests/ui-offline.spec.ts`:

```typescript
import { test, expect } from '@playwright/test'
import { createApp } from '../src/core/http/app.js'
import { serve } from '@hono/node-server'
// 最小構成の service/scenarios でアプリを起動(既存の testing ヘルパを流用できればそれを使う)

test('/ui makes zero external requests when rendered', async ({ page }) => {
  // アプリを 0 番ポートで起動して baseURL を得る(実装は既存の起動ヘルパに合わせる)
  const external: string[] = []
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) external.push(req.url())
  })
  await page.goto(`${baseURL}/ui`, { waitUntil: 'networkidle' })
  expect(external, `external requests: ${external.join(', ')}`).toEqual([])
  await expect(page.locator('#swagger-ui')).toBeVisible()
})
```

- [ ] **Step 2: 実行して green を確認**

Run: `npm run test:e2e -- tests/ui-offline.spec.ts`
Expected: PASS(外部要求ゼロ)。ブラウザ起動不可の環境なら BLOCKED を報告(devcontainer にブラウザはある想定 = HANDOFF 記載)。

- [ ] **Step 3: コミット**

```bash
git add tests/ui-offline.spec.ts
git commit -m "$(printf 'test: assert /ui renders with zero external requests\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: playwright.config.ts の env 駆動化 + デモ spec 分離

**Files:**
- Modify: `playwright.config.ts`
- Move: `tests/login.spec.ts` → `examples/e2e/login.spec.ts`(import パスの `../` 深さを調整)
- Modify: `README.md`(demo E2E の実行方法の記述があれば追随。無ければ Task 13 で扱う)

**Interfaces:**
- Produces: `playwright.config.ts` は `BASE_URL` 環境変数駆動。デモ project は opt-in。fork の `npm run test:e2e` は既定でデモを実行しない。
- 注意: Task 4 の `tests/ui-offline.spec.ts` はテンプレート所有の API 検証なので**移動しない**(既定で実行されてよい。ただし外部依存が無いよう自己完結起動にする)。

- [ ] **Step 1: デモ spec を移動**

```bash
mkdir -p examples/e2e
git mv tests/login.spec.ts examples/e2e/login.spec.ts
```
`examples/e2e/login.spec.ts` の import を `../../src/...` に修正。

- [ ] **Step 2: playwright.config.ts を書き換え**

```typescript
import { defineConfig } from '@playwright/test'

const DEMO_PORT = 4321
const baseURL = process.env.BASE_URL ?? `http://localhost:${DEMO_PORT}`
const useDemo = !process.env.BASE_URL   // BASE_URL 未指定時のみデモを起動

export default defineConfig({
  testDir: './tests',              // テンプレート所有の API 検証(ui-offline 等)
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  use: { baseURL },
  // デモ spec は projects の opt-in。BASE_URL 未指定時のみ testDir にデモを追加
  projects: [
    { name: 'default', testDir: './tests' },
    ...(useDemo ? [{ name: 'demo', testDir: './examples/e2e' }] : []),
  ],
  ...(useDemo ? {
    webServer: {
      command: `npx tsx fixtures/demo-app/server.ts`,
      url: `http://localhost:${DEMO_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(DEMO_PORT) },
    },
  } : {}),
})
```
(既存の書き方に合わせて調整可。要件は「`BASE_URL` 指定時はデモ project も webServer も無効・fork の spec のみ対象」。)

- [ ] **Step 3: 分離の検証**

Run: `BASE_URL=http://example.invalid npx playwright test --list`
Expected: デモ(`examples/e2e/login.spec.ts`)が一覧に出ない。webServer(demo-app)が起動されない。
Run(デモ): `npm run test:e2e`(BASE_URL 未指定)
Expected: デモ project が動く(従来どおり login.spec.ts が demo-app に対して実行)。

- [ ] **Step 4: 全テスト**

Run: `npm test && npm run build`
Expected: PASS / clean

- [ ] **Step 5: コミット**

```bash
git add playwright.config.ts examples/e2e/login.spec.ts
git commit -m "$(printf 'refactor: make e2e config BASE_URL-driven; move demo spec to examples opt-in\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Phase 2 — Docker

### Task 6: `scripts/package-deps.sh` と `vendor/` 規約

**Files:**
- Create: `scripts/package-deps.sh`(実行権限付与)
- Modify: `.gitignore`(`vendor/` 追加)

- [ ] **Step 1: スクリプト作成**

`scripts/package-deps.sh`(外部ネット接続環境で実行):
```bash
#!/usr/bin/env bash
set -euo pipefail
# package.json の playwright バージョンを読む
PW_VERSION=$(node -p "require('./package.json').dependencies.playwright")
mkdir -p vendor
# 1) node_modules.tar.gz
npm ci
tar czf vendor/node_modules.tar.gz node_modules
# 2) ベースイメージ save(バージョン一致)
docker pull "mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
docker save -o vendor/playwright-base.tar "mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "wrote vendor/node_modules.tar.gz and vendor/playwright-base.tar"
```

- [ ] **Step 2: .gitignore に `vendor/` を追加**(build & run artifacts セクション)。

- [ ] **Step 3: 検証**

Run: `bash -n scripts/package-deps.sh && chmod +x scripts/package-deps.sh && grep -c '^vendor/' .gitignore`
Expected: 構文 OK / `1`
(実行そのものは docker+npm が要るため CI/ローカルでは任意。構文チェックのみ必須。)

- [ ] **Step 4: コミット**

```bash
git add scripts/package-deps.sh .gitignore
git commit -m "$(printf 'build: add package-deps.sh and vendor/ convention for offline artifacts\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: `Dockerfile` と `.dockerignore`

**Files:**
- Create: `Dockerfile`(spec §3 の逐語ブロックを使用)
- Create: `.dockerignore`

- [ ] **Step 1: Dockerfile を作成** — spec `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` §3 のコードブロック(`ARG BASE_IMAGE=…` から `CMD ["node","dist/index.js"]` まで)を**そのまま**使う。

- [ ] **Step 2: `.dockerignore` を作成**:
```
node_modules
runs
test-results
playwright-report
dist
.git
vendor/playwright-base.tar
```
(`vendor/node_modules.tar.gz` はビルドコンテキストに必要なので除外しない。)

- [ ] **Step 3: 検証**

Run: `test -f Dockerfile && test -f .dockerignore && grep -c 'chmod -R g=u' Dockerfile && grep -c 'BROWSER_LAUNCH_ARGS' Dockerfile`
Expected: 各 `1`
Run(可能なら): `vendor/` に成果物がある環境で `docker build -t playwright-api:test .`
Expected: 成功。docker 不可ならスキップし、ユーザー環境での検証依頼を報告。

- [ ] **Step 4: コミット**

```bash
git add Dockerfile .dockerignore
git commit -m "$(printf 'build: add offline 2-stage Dockerfile and .dockerignore\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: `docs/offline-build.md`

**Files:**
- Create: `docs/offline-build.md`

- [ ] **Step 1: 手順書を作成** — 内容: (1) バージョン整合の原則(playwright npm==イメージタグ)、(2) 外部環境での `scripts/package-deps.sh` 実行 → `vendor/node_modules.tar.gz`・`vendor/playwright-base.tar` 生成、(3) オフライン側への持ち込み(`docker load -i vendor/playwright-base.tar`、必要なら内部レジストリ push)、(4) `docker build`(`--build-arg BASE_IMAGE=<内部タグ>` の使い方)、(5) 更新時のバージョン対応表。

- [ ] **Step 2: 検証**

Run: `grep -c 'docker load' docs/offline-build.md && grep -c 'node_modules.tar.gz' docs/offline-build.md`
Expected: 各 `1` 以上

- [ ] **Step 3: コミット**

```bash
git add docs/offline-build.md
git commit -m "$(printf 'docs: add offline build procedure\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Phase 3 — OpenShift (Kustomize)

### Task 9: `deploy/base`(Route なし)

**Files:**
- Create: `deploy/base/kustomization.yaml`
- Create: `deploy/base/deployment.yaml`
- Create: `deploy/base/service.yaml`

- [ ] **Step 1: マニフェスト作成** — spec §4「deployment.yaml の要点」に従う:
  - `deployment.yaml`: pod `runAsNonRoot: true`, `seccompProfile: RuntimeDefault`; container `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`; `runAsUser`/`fsGroup` は書かない。`RUNS_DIR`(/app/runs)と `/tmp` を emptyDir。probes liveness/readiness とも `GET /health`。requests `cpu:250m/memory:512Mi`、limits `memory:2Gi`。`envFrom` で overlay の ConfigMap を注入。`replicas:1`。
  - `service.yaml`: ClusterIP、port 3000。
  - `kustomization.yaml`: `resources: [deployment.yaml, service.yaml]`(**route.yaml を含めない**)。

- [ ] **Step 2: 検証**

Run: `kubectl kustomize deploy/base >/dev/null && echo ok`(または `oc kustomize`、無ければ `kustomize build`)
Expected: `ok`(妥当な YAML 出力)
Run: `kubectl kustomize deploy/base | grep -c 'kind: Route'`
Expected: `0`(base に Route 無し)
Run: `kubectl kustomize deploy/base | grep -c 'runAsUser'`
Expected: `0`

- [ ] **Step 3: コミット**

```bash
git add deploy/base
git commit -m "$(printf 'feat: add OpenShift base manifests (no Route, restricted-v2 SCC)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: `deploy/overlays/example`(Route opt-in)

**Files:**
- Create: `deploy/overlays/example/kustomization.yaml`
- Create: `deploy/overlays/example/configmap.yaml`
- Create: `deploy/overlays/example/route.yaml`

- [ ] **Step 1: overlay 作成**
  - `kustomization.yaml`: `resources: [../../base, route.yaml]`、`configMapGenerator` か `configmap.yaml`、イメージ名/タグ・replicas・リソースの patch。
  - `configmap.yaml`: `BASE_URL`, `MAX_CONCURRENCY` 等。
  - `route.yaml`: TLS 終端(`tls.termination: edge` 等)を設定し、コメントで「無認証のまま公開しない。認証プロキシ/到達元制限を別途設ける」ことを明記。

- [ ] **Step 2: 検証**

Run: `kubectl kustomize deploy/overlays/example >/dev/null && echo ok`
Expected: `ok`
Run: `kubectl kustomize deploy/overlays/example | grep -c 'kind: Route'`
Expected: `1`(overlay では Route が opt-in で入る)
Run: `kubectl kustomize deploy/overlays/example | grep -c 'tls:'`
Expected: `1` 以上

- [ ] **Step 3: コミット**

```bash
git add deploy/overlays
git commit -m "$(printf 'feat: add example overlay with opt-in Route (TLS, auth required)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: `docs/deploy-openshift.md`

**Files:**
- Create: `docs/deploy-openshift.md`

- [ ] **Step 1: 手順書作成** — 内容: overlay をシステム名にコピー、イメージタグ設定、`oc apply -k deploy/overlays/<system>`、**Route を公開する場合の必須保護**(認証・TLS・到達元制限)、emptyDir/probes の説明、restricted-v2 SCC の前提。

- [ ] **Step 2: 検証**

Run: `grep -c 'oc apply -k' docs/deploy-openshift.md && grep -c '認証' docs/deploy-openshift.md`
Expected: 各 `1` 以上

- [ ] **Step 3: コミット**

```bash
git add docs/deploy-openshift.md
git commit -m "$(printf 'docs: add OpenShift deploy guide (Route protection required)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Phase 4 — テンプレート運用

### Task 12: `scripts/sync-upstream.sh`

**Files:**
- Create: `scripts/sync-upstream.sh`(実行権限付与)

- [ ] **Step 1: スクリプト作成**
```bash
#!/usr/bin/env bash
set -euo pipefail
if ! git remote | grep -qx upstream; then
  echo "upstream 未登録です。次を実行してください:"
  echo "  git remote add upstream <社内Gitのテンプレートrepo URL>"
  exit 1
fi
REF="${1:-upstream/main}"
git fetch upstream
echo "merging ${REF} ..."
if ! git merge "${REF}"; then
  echo "衝突しました。所有権表は docs（README の所有権表）を参照して手動解決してください。"
  echo "テンプレート所有パスは原則 fork 側で編集しません。"
  exit 1
fi
```

- [ ] **Step 2: bare repo で動作確認**
```bash
tmp=$(mktemp -d)
git init --bare "$tmp/upstream.git"
# クローンを upstream に見立て、sync-upstream.sh の分岐(未登録案内→登録後 merge)を確認
```
最低限: `bash -n scripts/sync-upstream.sh`(構文)+ upstream 未登録時に案内メッセージと exit 1 を返すことを確認。

Run: `bash -n scripts/sync-upstream.sh && chmod +x scripts/sync-upstream.sh && (cd $(mktemp -d) && git init -q && bash /workspace/scripts/sync-upstream.sh; echo "exit=$?")`
Expected: 構文 OK。upstream 未登録の一時 repo で案内表示 + `exit=1`。

- [ ] **Step 3: コミット**

```bash
git add scripts/sync-upstream.sh
git commit -m "$(printf 'feat: add sync-upstream.sh for template merge workflow\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 13: README 更新(所有権表・fork 手順・demo-app 残す)

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 9/10/12 の deploy・scripts。既に PR #1 で追記された「開発運用」節がある点に注意(重複しないよう追記)。

- [ ] **Step 1: README を更新**
  - **所有権表**を追記(spec §5): テンプレート所有 / システム(fork)所有 / 共有(削除しない)の3分類。
  - **fork 手順**: `git remote add upstream …` と `scripts/sync-upstream.sh`(引数なし=upstream/main、タグ指定=`template-vX.Y.Z`)。
  - **demo-app 「残す」**: 既に Task(PR #1)で 77 行目を「残す」に修正済み。ここでは fork のシナリオ登録解除は `src/scenarios/index.ts` で行う旨と整合させる。
  - **E2E の実行**: fork は `BASE_URL=<自システム>` を与えて `npm run test:e2e`(デモは既定で走らない)。
  - **オフライン/デプロイ**: `docs/offline-build.md`・`docs/deploy-openshift.md` へのリンク。

- [ ] **Step 2: 検証**

Run: `grep -c '所有権' README.md && grep -c 'sync-upstream' README.md && grep -c 'BASE_URL' README.md`
Expected: 各 `1` 以上

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "$(printf 'docs: README ownership table, fork sync steps, BASE_URL e2e usage\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 14: 全体検証(最終レビュー前ゲート)

**Files:** (検証のみ)

- [ ] **Step 1: 全テスト + ビルド**

Run: `npm test && npm run build`
Expected: すべて PASS / clean

- [ ] **Step 2: E2E(可能なら)**

Run: `npm run test:e2e`(デモ)+ `npm run test:e2e -- tests/ui-offline.spec.ts`
Expected: PASS。ブラウザ不可ならその旨報告。

- [ ] **Step 3: Kustomize 出力の妥当性**

Run: `kubectl kustomize deploy/overlays/example >/dev/null && kubectl kustomize deploy/base >/dev/null && echo ok`
Expected: `ok`

- [ ] **Step 4: base の最新取り込み(最終レビュー前)**

Run: `git fetch origin && git merge origin/main`（この devcontainer は ssh 不可のため、必要なら `git fetch https://github.com/sumikof/playwright-api.git main` を使う）
Expected: コンフリクトなし。

- [ ] **Step 5: PR に検証結果を記録**(手動)し、運用フロー §「ワークフロー」手順11→12(Draft 解除 → `@codex review` 最終レビュー)へ接続。

---

## 実装後の接続(この plan の外)

- 本 plan 完了後、PR #3 で **Codex 最終レビュー → ユーザー受け入れ → マージ**。
- docker build / 実クラスタ適用がこの devcontainer で不可の項目は、ユーザー環境での検証を依頼する(spec の前提どおり node_modules・ベースイメージは外部調達)。
