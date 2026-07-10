# 引き継ぎ書 — Playwright E2E API サーバ ひな形

最終更新: 2026-07-10

## このドキュメントの目的

devcontainerでPlaywrightのブラウザが起動できず、root権限がないためセッション内から修復できない。
コンテナをroot権限で入り直したあと、ここから作業を再開するための引き継ぎ。

---

## 1. 何を作っているか

HTTPリクエストを受けてPlaywrightのシナリオを実行し、結果を返すAPIサーバの**ひな形**。
このリポジトリをコピーして、複数システムのE2Eテスト基盤として使う。

APIはOpenAPIとして公開され、クライアントはOpenAPIドキュメントを読むだけで、
実行可能なシナリオの一覧と各シナリオに必要なパラメータを知ることができる。

**設計スペックは `docs/superpowers/specs/2026-07-09-playwright-e2e-api-server-design.md` にある。**
ブレインストーミングは完了し、ユーザーの承認済み。コミット `e659f64`。

## 2. 現在地

| フェーズ | 状態 |
|---|---|
| ブレインストーミング | 完了・ユーザー承認済み |
| 設計スペックの作成とコミット | 完了（`e659f64`） |
| **実装計画の作成** | **未着手 ← ここから再開** |
| 実装 | 未着手 |

実装コードはまだ1行も書いていない。`src/index.ts` は `hono create` 直後のスケルトンのまま。

## 3. 設計の要点（スペックの要約）

詳細はスペックを読むこと。以下は再開時に頭に入れておく骨子。

**中心となる判断: シナリオが唯一の実体であり、2つの入口がそれを呼ぶ。**

```
                  ┌─ HTTP (Hono) → queue → runner → BrowserProvider ─┐
scenario.run() ───┤                                                   ├─→ page
                  └─ @playwright/test (fixture の page を渡す) ───────┘
```

決定事項:

- シナリオは `run(ctx, params) => result` の関数。子プロセスで `npx playwright test` は起動しない
- Playwright Library API をサーバプロセス内で直接使う（単一Node.jsプロセス）
- シナリオごとに個別のOpenAPIパスを生成する。Zodスキーマが requestBody になり、OpenAPI自体がシナリオカタログになる
- 非同期ジョブ。`POST /scenarios/{id}/runs` → `202 {runId}`、`GET /scenarios/{id}/runs/{runId}` でポーリング
- DBは持たない。実行中はインメモリMap、完了時に `runs/{runId}/result.json` を書く
- `BrowserProvider` 抽象。既定は `LocalBrowserProvider`（`chromium.launch()`）、`BROWSER_WS_ENDPOINT` があれば `RemoteBrowserProvider`（`chromium.connect()`）
- ブラウザ1つを共有し、run毎に `BrowserContext` を作って破棄する。ブラウザプールは作らない
- キューで同時実行制御。`MAX_CONCURRENCY` 既定 `1`、`MAX_QUEUE` 既定 `100`（超過で `503`）
- 明示スクリーンショット（`ctx.screenshot(name)`）は常に保存。`trace.zip` は失敗時のみ。動画は取らない
- シナリオの失敗はHTTPエラーではない。`200` + `status: "failed"` を返す
- `src/core/` は触らない骨格、`src/pages/` `src/scenarios/` `tests/` がシステム固有
- `fixtures/demo-app/` にテスト対象アプリを同梱し、オフラインで全テストが通るようにする
- 認証と秘匿パラメータのマスクは**意図的に入れない**（スペックの「意図的に含めないもの」を参照）

---

## 4. ブロッカー: devcontainerでブラウザが起動しない

### 症状

```
Error: browserType.launch:
╔══════════════════════════════════════════════════════╗
║ Host system is missing dependencies to run browsers. ║
║ Please install them with the following command:      ║
║     sudo npx playwright install-deps                 ║
╚══════════════════════════════════════════════════════╝
```

### 調査結果

- `npx playwright install chromium` によるブラウザ本体のダウンロードは**成功する**（`~/.cache/ms-playwright/` に配置済み）
- 起動に失敗するのは、`ubuntu:24.04` ベースイメージに共有ライブラリが無いため
- `ldd headless_shell | grep "not found"` で確認した不足ライブラリ:
  `libglib-2.0.so.0`, `libgobject-2.0.so.0`, `libnspr4.so`, `libnss3.so`, `libnssutil3.so`,
  `libgio-2.0.so.0`, `libatk-1.0.so.0`, `libdbus-1.so.3`, `libX11.so.6`, `libXcomposite.so.1`,
  `libXdamage.so.1`, `libXext.so.6`, `libXfixes.so.3`, `libXrandr.so.2`, `libgbm.so.1`,
  `libxcb.so.1`, `libxkbcommon.so.0`, `libasound.so.2`, `libatspi.so.0`
- コンテナ内のユーザーは `uid=1000(ubuntu)`。`/usr/lib` に書き込めない
- `apt-get` は存在するが root が必要。`sudo` バイナリが**インストールされていない**（ユーザーは `sudo` グループには属している）

つまり、セッション内から後付けで修復する手段はない。

### 最短の手順（rootで入り直した直後にこれを実行する）

rootであれば apt が使えるので、その場で不足ライブラリを入れられる。

```bash
npx playwright install-deps chromium   # apt で共有ライブラリを入れる
npx playwright install chromium        # ブラウザ本体（未取得なら）
```

ただし**これはコンテナをリビルドすると消える**。下の恒久対応も併せて入れること。

### 恒久対応（イメージ定義を直す）

以下のいずれか。**推奨は A**。

#### A. `.devcontainer/Dockerfile` を追加する（推奨）

ビルド時にrootで apt install するため確実で、イメージ層にキャッシュされるのでコンテナ起動が遅くならない。
既存の `features` / `remoteUser` / `mounts` はそのまま使える。

`.devcontainer/Dockerfile`:

```dockerfile
FROM ubuntu:24.04

# Playwright(Chromium) の実行に必要な共有ライブラリ。
# 一覧は `npx playwright install-deps --dry-run chromium` の出力に対応する。
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      sudo \
      fonts-liberation \
      libasound2t64 \
      libatk-bridge2.0-0t64 \
      libatk1.0-0t64 \
      libatspi2.0-0t64 \
      libcairo2 \
      libcups2t64 \
      libdbus-1-3 \
      libgbm1 \
      libglib2.0-0t64 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# ubuntu ユーザーが後から apt を使えるように
RUN echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu
```

`.devcontainer/devcontainer.json` の変更（`"image"` を `"build"` に置き換える）:

```jsonc
{
  "name": "Claude Code Sandbox",
  "build": { "dockerfile": "Dockerfile" },
  // features / runArgs / remoteUser / mounts / appPort / containerEnv はそのまま
}
```

`postCreateCommand` に `npx playwright install chromium` を足しておくと、コンテナ作成時にブラウザ本体も入る。

#### B. ベースイメージを Playwright 公式に変える

`mcr.microsoft.com/playwright:v1.x-noble` はブラウザと依存関係を同梱している。
ただしユーザー名が `pwuser` で、`remoteUser: ubuntu` / `mounts` / `CLAUDE_CONFIG_DIR=/home/ubuntu/.claude` の調整が必要になる。

#### C. `common-utils` feature で sudo を入れる

`devcontainer.json` の変更だけで済むが、コンテナ作成のたびに apt が走り、
`sudo` 下での `PATH` 解決（`npx` が見つからない）を踏みやすい。

### 検証手順（対処後にこれが通ること）

```bash
npm install
npx playwright install chromium
node -e "
  const { chromium } = require('playwright');
  (async () => {
    const b = await chromium.launch();
    const p = await (await b.newContext()).newPage();
    await p.setContent('<h1 id=t>hello</h1>');
    console.log(await p.locator('#t').textContent());
    await b.close();
  })();
"
# → hello と出れば解決
```

---

## 5. 調査済みの技術的事実

再開時に再調査しなくてよいように記録する。すべて実際に動かして確認済み。

### インストール済みバージョン

| パッケージ | バージョン | 備考 |
|---|---|---|
| `@hono/zod-openapi` | 1.4.0 | peer: `hono >=4.10.0`, `zod ^4.0.0` |
| `zod` | 4.4.3 | |
| `hono` | 4.12.28 | |
| `@hono/swagger-ui` | 0.6.1 | |
| `@hono/node-server` | 2.0.8 | |
| Node | v24.18.0 | |

### zod v4 で使える関数（確認済み）

`z.iso.datetime()`, `z.stringbool()`, `z.prettifyError()`, `z.url()`, `z.email()`, `z.coerce.number()`

### `@hono/zod-openapi` 1.4.0 の挙動（確認済み）

- `@hono/zod-openapi` から再エクスポートされる `z` は `extendZodWithOpenApi` 済みで、スキーマに `.openapi()` と `.meta()` の両方が生える
- **ループ内での動的ルート登録が正しく動く。** `for (const sc of scenarios) app.openapi(createRoute({ path: \`/scenarios/${sc.id}/runs\`, ... }), handler)` で、OpenAPIドキュメントに全シナリオのパスが出る
- 生成される requestBody は Zodスキーマそのまま:
  `{"type":"object","properties":{"email":{"type":"string","format":"email"},...}}`
- ジェネリックな `runResultSchema(scenario.result)` で `data` プロパティが各シナリオの result スキーマになる（`data.nullable()` は `nullable: true` として出る）
- `defaultHook` でバリデーション失敗を一元的に `400` にできる。動作確認済み
- バイナリ配信は `content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } }` で宣言し、ハンドラが `c.newResponse(buffer, 200, headers)` を返せばよい。**型も通る**
- **上記はすべて `as any` なしで `tsc --strict --module NodeNext --verbatimModuleSyntax` を通ることを確認済み。**
  型回避策は不要。ただし動的登録なのでHonoのRPC型推論は効かない（OpenAPIドキュメント生成には影響しない）

### 設計上の注意（調査から判明したこと）

- **`src/pages/*.page.ts` で `@playwright/test` の `expect` を使わないこと。**
  使うとサーバの実行時コードが `@playwright/test`（テストランナー）に依存する。
  代わりに `await locator.waitFor({ state: 'visible' })` を使えば `playwright` パッケージだけで済み、
  APIサーバ経由でも `@playwright/test` 経由でも同一に動く。
  `tests/*.spec.ts` の中では `expect` を自由に使ってよい。
- `tsconfig.json` は `module: NodeNext` なので、相対importには `.js` 拡張子が必要（`import { x } from './foo.js'`）
- `tsconfig.json` は現状 `include` が無く、`exclude: ["node_modules"]` だけ。
  ビルド対象を `src` に絞る（`include: ["src"]`, `rootDir: "src"`）必要がある。
  そうしないと `tests/` や `fixtures/` まで `dist/` に出力され、`npm start` の `node dist/index.js` が壊れる

### スペックからの微修正（実装計画に反映すること）

調査中に見つかった、スペック本文とずれる点。**実装計画ではこちらを正とする**:

1. **`runs/{runId}/screenshots/` サブディレクトリは作らず、フラットに置く。**
   スペックは `runs/{runId}/screenshots/01-product-list.png` と書いているが、
   アーティファクト名にスラッシュが入ると `GET /runs/{runId}/artifacts/{name}` のパスパラメータで受けられない。
   `runs/{runId}/01-product-list.png` とし、`trace.zip` / `failure.png` / `result.json` / `meta.json` を同階層に置く。
2. **`startedAt` を `string | null` にし、`queuedAt` を追加する。**
   スペックの `startedAt` は「実行開始時刻」だが、キュー待ち時間が `durationMs` に混ざると誤解を生む。
   `queuedAt`（受理時刻）と `startedAt`（`running` 遷移時刻、`queued` の間は `null`）を分け、
   `durationMs` は `finishedAt - startedAt` とする。
3. **`RunStore.create()` が `meta.json` を書く。**
   プロセス再起動で `queued` / `running` の記録がメモリから消えたとき、
   `result.json` が無く `meta.json` があるディレクトリを `status: "interrupted"` として復元するため。
   `meta.json` は `{ runId, scenarioId, params, queuedAt }` を持つ。
   `get()` の探索順は「メモリ → `result.json` → `meta.json` → `undefined`（`404`）」。

## 6. リポジトリの状態

```
M .devcontainer/devcontainer.json   ← セッション開始前からの変更（未コミット）
?? .gitignore  README.md  package.json  package-lock.json  src/  tsconfig.json
                                    ← hono create の生成物（未コミット）
```

コミット済み:
- `5a24446` setup devcontainer
- `e659f64` Add design spec for Playwright E2E API server template

注意点:

- `git config user.email` / `user.name` をこのリポジトリにローカル設定した（`.git/config` に残るのでroot再入後も有効）
- 調査のために `npm install --no-save playwright@latest` を実行した。`node_modules/` に `playwright` が入っているが
  `package.json` と `package-lock.json` は変更していない。実装時に `npm install` で正式に依存へ追加すること
- `~/.cache/ms-playwright/` に chromium がダウンロード済み。**コンテナをリビルドすると消える**（ホームがボリュームでないため）

---

## 7. 再開手順

1. root権限でコンテナに入り直す
2. 上記「4. ブロッカー」の対処案 A を適用する（`.devcontainer/Dockerfile` の追加 + `devcontainer.json` の `image` → `build`）
3. コンテナをリビルドする
4. 「検証手順」のスニペットで `hello` が出ることを確認する
5. Claude Code を起動し、このファイルを読ませる
6. **`superpowers:writing-plans` スキルで実装計画を作る。**
   入力は `docs/superpowers/specs/2026-07-09-playwright-e2e-api-server-design.md` と、
   本ファイルの「5. 調査済みの技術的事実」および「スペックからの微修正」
7. 計画を `docs/superpowers/plans/YYYY-MM-DD-playwright-e2e-api-server.md` に保存してコミット
8. `superpowers:subagent-driven-development` または `superpowers:executing-plans` で実装する

### 実装計画に含めるべきタスクの見取り図

計画作成時の出発点として。各タスクはTDD（失敗するテストを書く → 実行して落ちることを確認 → 最小実装 → 通す → コミット）で進める。

| # | タスク | テスト |
|---|---|---|
| 1 | devcontainer修正 + 依存追加（`playwright`, `@playwright/test`, `vitest`, `ulid`）+ tsconfig/vitest設定 | ブラウザ起動の検証スニペット |
| 2 | `core/config.ts` — 環境変数のZod検証 | Vitest |
| 3 | `core/scenario.ts` + `core/registry.ts` — `defineScenario()`、ID重複検出 | Vitest |
| 4 | `core/run/types.ts` + `core/run/store.ts` — `RunStore`（Map + FS、`interrupted` 復元） | Vitest |
| 5 | `core/run/queue.ts` — `MAX_CONCURRENCY` / `MAX_QUEUE` / `drain()` | Vitest |
| 6 | `core/browser/` — `BrowserProvider` 抽象 + Local / Remote | Vitest（Local は実ブラウザ1本） |
| 7 | `core/run/context.ts` + `core/run/runner.ts` — trace/screenshot のライフサイクル | Vitest（provider をfake） |
| 8 | `core/http/schemas.ts` + `core/http/routes/` — ルート生成、artifact配信、OpenAPI出力 | Vitest（`app.request()`） |
| 9 | `fixtures/demo-app/` — Honoで配信するログイン画面と商品一覧 | Vitest（`app.request()`） |
| 10 | `src/pages/` + `src/scenarios/login.ts` — POM とサンプルシナリオ | `@playwright/test` |
| 11 | `core/testing/` — `@playwright/test` からシナリオを呼ぶヘルパ | `@playwright/test` |
| 12 | `src/index.ts` — 起動、保持期間の掃除、グレースフルシャットダウン | 結合テスト |
| 13 | 結合テスト — APIサーバ経由でPOST → ポーリング → `passed` / `failed` | Vitest or `@playwright/test` |
| 14 | README — ひな形の使い方、コピー先で書き換える場所 | — |
