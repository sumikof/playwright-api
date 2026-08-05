# Playwright E2E API サーバ ひな形 — 設計

作成日: 2026-07-09

## 目的

HTTPリクエストを受けてPlaywrightのシナリオを実行し、結果を返すAPIサーバのひな形を作る。このリポジトリをコピーして、複数システムのE2Eテスト基盤として使う。

APIはOpenAPIとして公開する。クライアントはOpenAPIドキュメントを読むだけで、実行可能なシナリオの一覧と、各シナリオに必要なパラメータを知ることができる。

シナリオはPage Object Modelで構築し、APIサーバを介さずに `@playwright/test` から直接実行することもできる。

## 中心となる設計判断

**シナリオが唯一の実体であり、2つの入口がそれを呼ぶ。**

```
                  ┌─ HTTP (Hono) → queue → runner → BrowserProvider ─┐
scenario.run() ───┤                                                   ├─→ page
                  └─ @playwright/test (fixture の page を渡す) ───────┘
```

シナリオは `run(ctx, params) => result` という関数として定義される。APIサーバはブラウザを起動して `ctx` を組み立ててからこれを呼ぶ。`@playwright/test` のspecファイルは、fixtureの `page` から `ctx` を組み立てて同じ関数を呼ぶ。

シナリオを子プロセスで `npx playwright test` として起動する方式は採らない。パラメータの環境変数経由の受け渡し、JSONレポートのパース、`--grep` によるテスト名マッチングという間接層がすべて不要になり、「単一Node.jsプロセスで実行する」という制約も自然に満たせる。

## API

```
GET  /scenarios                        シナリオ一覧（id, summary, tags）
POST /scenarios/{id}/runs          →   202 { runId, status: "queued" }
GET  /scenarios/{id}/runs/{runId}  →   200 実行結果（data は型付き）
GET  /runs/{runId}/artifacts/{name} →  200 ファイル配信
GET  /doc                              OpenAPI JSON
GET  /ui                               Swagger UI
GET  /health                           200 { status: "ok" }
```

### シナリオごとに個別のパスを生成する

レジストリに登録されたシナリオごとにHonoのルートを作る。各シナリオが宣言するZodスキーマがそのままそのパスの `requestBody` になるため、**OpenAPIドキュメント自体がシナリオカタログになる**。Swagger UIを開けばシナリオごとに入力フォームが出て、生成クライアントは型付きになる。ディスカバリのための独自機構を作る必要がない。

`GET /scenarios` はプログラムから一覧を取るためのサマリエンドポイントとして併せて提供する。

### 結果取得をシナリオ配下に置く

`GET /runs/{runId}` という汎用パスにすると、どのシナリオの結果を返すかがOpenAPI上で決まらず、`data` が `unknown` に落ちる。`result` スキーマを宣言させる意味が失われる。

クライアントはPOSTした時点でシナリオIDを知っているので、取得時にも指定できて当然である。`GET /scenarios/{id}/runs/{runId}` のレスポンススキーマは、そのシナリオの `result` スキーマを埋め込んだものになる。生成クライアントは `data.userName` に型が付く。

指定された `runId` の実行が別のシナリオのものだった場合は `404` を返す。

### シナリオの失敗はHTTPエラーではない

アサーションが落ちても `GET /scenarios/{id}/runs/{runId}` は `200` を返し、ボディが `status: "failed"` になる。これを `500` にすると、クライアントは「サーバが壊れた」と「テストが落ちた」を区別できない。

HTTPステータスコードの割り当て:

| コード | 条件 |
|---|---|
| `400` | リクエストボディがparamsスキーマに適合しない |
| `404` | 未知のシナリオID、未知のrunId、runIdとシナリオIDの不一致、未知のartifact名 |
| `503` | 実行キューが `MAX_QUEUE` に達している |

## 実行モデル

### 非同期ジョブ + インメモリ + ファイルシステム

Playwrightのシナリオ実行は数十秒から数分かかるため、同期実行はHTTPタイムアウトの問題を抱える。`POST` は即座に `202 { runId }` を返し、クライアントは `GET` でポーリングする。

状態の保持にデータベースは導入しない。成果物（スクリーンショット、trace）はどのみちファイルとして出力されるため、`runs/{runId}/` ディレクトリ自体をレコードとして扱う。

- 実行中の状態はプロセス内の `Map` が持つ
- 完了時に `runs/{runId}/result.json` を書く
- `GET` は「Mapにあればそれを返し、なければディスクを読む」

これによりプロセス再起動をまたいでも完了済みの結果が残る。`runs/` を消せば全リセットできる。

`RunStore` インターフェースの背後にこの実装を隠すため、将来SQLiteやRedisに差し替えるときの変更範囲はそこだけに閉じる。

```ts
interface RunStore {
  create(runId: string, scenarioId: string, params: unknown): Promise<void>
  markRunning(runId: string): Promise<void>
  finish(runId: string, result: RunResult): Promise<void>
  get(runId: string): Promise<RunResult | undefined>
}
```

**再起動で失われる実行の扱い**: `queued` と `running` の状態はメモリにしか存在しない。プロセスが再起動すると、`runs/{runId}/` は存在するのに `result.json` が無いディレクトリが残る。`get()` はこの状態を検出して `status: "interrupted"` を返す。ディレクトリ自体が無ければ `undefined` を返し、ルートは `404` にする。

### 実行状態

```
queued → running → passed
                 → failed
       ↘ (プロセス再起動) → interrupted
```

### キューと同時実行制御

単一プロセスでブラウザを起動するため、同時実行数を制限しないとメモリが枯渇する。

- `MAX_CONCURRENCY`（既定 `1`）— 同時に走るシナリオ数
- `MAX_QUEUE`（既定 `100`）— 待機できるジョブ数。超えたら `503`

既定を `1`（直列）にする理由は、同一システムに対する並列E2Eがデータ競合を起こしやすいためである。同じユーザーでログインする2本のシナリオは互いのセッションを壊し得る。競合しないことが分かっているシステムだけ、環境変数で `2` 以上に上げる。

キューは配列と実行中カウンタだけの素朴な実装にする。外部のジョブキューは導入しない。

## ブラウザの調達

### BrowserProvider 抽象

```ts
interface BrowserProvider {
  acquireContext(options: BrowserContextOptions): Promise<BrowserContext>
  close(): Promise<void>
}
```

- `LocalBrowserProvider` — `chromium.launch()` でプロセス内にブラウザを起動する（既定）
- `RemoteBrowserProvider` — `chromium.connect(wsEndpoint)` で外部のブラウザサーバに接続する

`BROWSER_WS_ENDPOINT` が設定されていればRemote、なければLocalを選ぶ。シナリオ実行側は `provider.acquireContext()` を呼ぶだけで、どちらかを知らない。

### なぜブラウザプールを作らないか

Selenium Gridではセッションがほぼブラウザプロセスに対応するため、並列実行にはプロセスを並べるしかなく、それを配るためにGridが要る。Playwrightの分離単位は `BrowserContext` であり、これはクッキー・ストレージ・キャッシュが完全に独立した「シークレットウィンドウ」に相当し、生成コストはミリ秒である。

したがって **ブラウザ1つ + コンテキストN個** で、ノードを並べたのと同じ並列分離がプロセスを増やさずに得られる。ブラウザ起動は数秒かかるのでプロセス起動時に1度だけ行い、実行ごとに `BrowserContext` を新規作成して破棄する。

グリッド構成が実際に効くのは「複数マシンへの水平分散」「ブラウザのクラッシュを別プロセスへ隔離」「ブラウザバージョンをDockerイメージで固定」の3点であり、いずれも本ひな形の「単一Node.jsで実行する」という制約とは方向が逆である。それらが必要になったシステムでは `BROWSER_WS_ENDPOINT` を指定して `RemoteBrowserProvider` に切り替える。

## シナリオ定義

```ts
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

`params` と `result` のZodスキーマは、バリデーション・OpenAPIドキュメント・TypeScript型の3役を兼ねる。シナリオを1ファイル足せば、APIとドキュメントが同時に増える。

### ScenarioContext

```ts
interface ScenarioContext {
  readonly page: Page
  readonly baseURL: string
  step<T>(name: string, fn: () => Promise<T>): Promise<T>
  screenshot(name: string): Promise<void>
  waitForPopup(trigger: () => Promise<void>): Promise<ScenarioContext>
}
```

`ctx` はこの5つだけを公開する。`browser` や `browserContext` は渡さない。シナリオが自前でコンテキストを作れてしまうと、runnerによるtrace取得とクリーンアップが効かなくなるため。

`waitForPopup` は `target="_blank"` や `window.open` で開く新規タブへの対応。Playwrightでは新規タブは同一 `BrowserContext` 内の新しい `Page` として生まれるため、新しいブラウザコンテキストは作らない(作るとセッションが共有されず実挙動と乖離する)。返り値は新規タブを `page` に持つ子コンテキストで、ステップ・スクリーンショット連番・アーティファクトの記録は親と共有される。popupイベントはトリガー操作より先に待ち受けを開始しないと取り逃すため、トリガーはクロージャで受け取る設計とし、利用側が待ち受け順序を意識しなくてよいようにしている。新規タブ用のPage Objectは子コンテキストを渡して構築すれば、`BasePage` は無変更でそのまま使える。

実装は2つある。

- `ApiScenarioContext` — `step` は名前・所要時間・成否を配列に記録し、API応答の `steps[]` になる。`screenshot` は `runs/{runId}/screenshots/` に書く。
- `TestScenarioContext` — `step` は `test.step()` に委譲し、`screenshot` は `testInfo.attach()` する。

同じシナリオコードが、APIから呼ばれればJSONのステップ配列を、`@playwright/test` から呼ばれればPlaywrightのHTMLレポートを生成する。

### Page Object Model

`src/pages/` に配置する。各Page Objectは `constructor(page: Page)` を取り、セレクタを内部に隠し、操作と検証をメソッドとして公開する。シナリオはセレクタを直接触らない。

```ts
export class LoginPage {
  constructor(private readonly page: Page) {}
  private readonly email = () => this.page.getByLabel('メールアドレス')

  async goto() { await this.page.goto('/login') }
  async submit(email: string, password: string) { /* ... */ }
}
```

### レジストリ

`src/scenarios/index.ts` で明示的に列挙する。

```ts
export const scenarios = [loginScenario, checkoutScenario] as const
```

globによるファイル自動探索は採らない。`tsx` 実行時と `dist` 実行時でパス解決が変わり、型情報も失われる。10個程度のシナリオにその複雑さは見合わない。

`core/registry.ts` はこの配列を受け取り、IDの重複を起動時に検出して例外を投げる。

## 実行結果とアーティファクト

### 結果オブジェクト

```jsonc
{
  "runId": "01J...",
  "scenarioId": "login",
  "status": "failed",
  "params": { "email": "user@example.com", "password": "hunter2" },
  "startedAt": "2026-07-09T10:00:00.000Z",
  "finishedAt": "2026-07-09T10:00:12.345Z",
  "durationMs": 12345,
  "steps": [
    { "name": "ログイン画面を開く", "status": "passed", "durationMs": 820 },
    { "name": "資格情報を送信", "status": "failed", "durationMs": 5100,
      "error": { "message": "Timeout 5000ms exceeded" } }
  ],
  "data": null,
  "error": { "message": "Timeout 5000ms exceeded", "stack": "..." },
  "artifacts": [
    { "kind": "screenshot", "name": "failure.png", "url": "/runs/01J.../artifacts/failure.png" },
    { "kind": "trace", "name": "trace.zip", "url": "/runs/01J.../artifacts/trace.zip" }
  ]
}
```

成功時は `data` が `result` スキーマに適合するオブジェクト、`error` が `null` になる。失敗時はその逆。runnerは `data` を保存する前に `result` スキーマで検証し、適合しなければ `failed` として扱う。

`params` はリクエストされた値をそのまま記録する。どのパラメータで失敗したかが分からなければ失敗の調査ができないため。上の例のようにパスワードも平文で残る（「意図的に含めないもの」を参照）。

`runId` にはULIDを使う。生成順にソート可能なため、保持期間の掃除でファイル名だけを見て古い順に消せる。

### アーティファクトの取得ポリシー

**明示スクリーンショットは常に保存する。** `ctx.screenshot('product-list')` は成否によらず `runs/{runId}/screenshots/01-product-list.png` に書かれ、`artifacts[]` に載る。E2Eでは「成功時も証跡として残したい画面」という要求が必ず出る。連番を前置するのは、シナリオ内の実行順を保つため。

**traceは失敗時のみ保存する。** `context.tracing.start({ screenshots: true, snapshots: true, sources: true })` を常に呼んでおき、

- 成功時: `await context.tracing.stop()` をパスなしで呼ぶ（トレースは破棄される。ディスク書き込みゼロ）
- 失敗時: `await context.tracing.stop({ path: 'runs/{runId}/trace.zip' })`

失敗時にはあわせて `failure.png` を全画面で撮る。`trace.zip` はPlaywright Trace Viewerでそのまま開ける。

**動画は取らない。** Playwrightの動画はコンテキスト生成時に `recordVideo` を指定する必要があり、成功時も一度ファイルへ書かれてから消すことになるため「成功時ゼロコスト」が崩れる。またtraceにはアクションごとのスクリーンショットとDOMスナップショットが含まれるため、失敗調査で動画が追加で教えてくれることはほぼない。

### アーティファクト配信

`GET /runs/{runId}/artifacts/{name}` は、`result.json` の `artifacts[]` に載っている名前だけを配信する。ディレクトリを走査してファイル名を受け付けるのではなく、記録済みの名前とのマッチングで判定する。これによりパストラバーサルの余地がなくなる。

### 保持期間

起動時に `runs/` を走査し、`RUN_RETENTION`（既定 `50`）件を超える古いディレクトリを削除する。バックグラウンドの定期実行はしない。実行のたびに掃除を走らせるとレイテンシに乗るため、起動時の1回だけにする。

## ディレクトリ構造

`src/core/` はコピー先で触らない骨格、それ以外はシステム固有。この境界が本ひな形の中心的な価値である。

```
src/
  core/
    scenario.ts            defineScenario() と Scenario / ScenarioContext 型
    registry.ts            シナリオ配列 → Map、ID重複検出
    config.ts              環境変数の読み取りと既定値
    browser/
      provider.ts          BrowserProvider インターフェース
      local.ts             chromium.launch()
      remote.ts            chromium.connect(wsEndpoint)
    run/
      queue.ts             MAX_CONCURRENCY / MAX_QUEUE
      runner.ts            context生成 → tracing開始 → run() → artifact収集 → 破棄
      store.ts             RunStore (Map + FS)
      context.ts           ApiScenarioContext
      retention.ts         起動時の古いrunディレクトリ削除
      id.ts                ULID生成
    testing/
      context.ts           TestScenarioContext
      run-in-test.ts       @playwright/test から呼ぶヘルパ
    http/
      app.ts               Hono app の組み立て
      openapi.ts           OpenAPIドキュメント + Swagger UI
      schemas.ts           RunResult スキーマのファクトリ
      routes/
        scenarios.ts       レジストリからPOST/GETルートを生成
        artifacts.ts       artifact配信
        health.ts

  pages/                   ★ システム固有: Page Object Model
    login.page.ts
    product-list.page.ts
  scenarios/               ★ システム固有: シナリオ定義
    login.ts
    index.ts               レジストリへの明示登録
  index.ts                 エントリポイント

fixtures/
  demo-app/                ★ ひな形同梱のテスト対象アプリ（コピー先では削除）
    app.ts                 Honoで配信するログイン画面と商品一覧

tests/                     ★ システム固有: @playwright/test からシナリオを実行
  login.spec.ts
  api.integration.spec.ts  APIサーバ経由でPOST → ポーリング → passed を確認

playwright.config.ts
vitest.config.ts
runs/                      実行結果とアーティファクト（gitignore）
```

新しいシステムへ展開するときは `src/pages/`、`src/scenarios/`、`tests/` を書き換え、`fixtures/demo-app/` を削除する。`src/core/` はそのまま。将来 `core` をnpmパッケージへ切り出す余地も残る。

## 設定

すべて環境変数で与える。

| 変数 | 既定値 | 説明 |
|---|---|---|
| `PORT` | `3000` | APIサーバの待ち受けポート |
| `BASE_URL` | (必須) | テスト対象システムのベースURL |
| `BROWSER` | `chromium` | `chromium` \| `firefox` \| `webkit` |
| `HEADLESS` | `true` | ヘッドレス実行 |
| `BROWSER_WS_ENDPOINT` | (未設定) | 設定時は RemoteBrowserProvider を使う |
| `MAX_CONCURRENCY` | `1` | 同時実行シナリオ数 |
| `MAX_QUEUE` | `100` | 待機ジョブ数の上限。超過で `503` |
| `RUNS_DIR` | `./runs` | 実行結果の保存先 |
| `RUN_RETENTION` | `50` | 保持する実行ディレクトリ数 |
| `SCENARIO_TIMEOUT_MS` | `120000` | 1シナリオの実行時間上限 |

`config.ts` はZodでこれらを検証し、不正なら起動時に落ちる。`BASE_URL` の未設定はサーバを起動させない。

## ライフサイクル

**起動時**: 設定を検証 → `runs/` の保持期間掃除 → レジストリを構築（ID重複検出）→ `BrowserProvider` を初期化（ブラウザ起動または接続）→ Honoサーバを待ち受け開始。

**シナリオ実行時**:

1. キューがジョブを取り出し、`store.markRunning(runId)`
2. `provider.acquireContext({ baseURL })` でコンテキストを生成
3. `context.tracing.start({ screenshots: true, snapshots: true, sources: true })`
4. `ApiScenarioContext` を組み立て、`SCENARIO_TIMEOUT_MS` のタイムアウト付きで `scenario.run(ctx, params)` を呼ぶ
5. 成功時は `result` スキーマで戻り値を検証、失敗時は `failure.png` を撮る
6. `context.tracing.stop()`（成功時はパスなし、失敗時は `trace.zip`）
7. `context.close()`
8. `store.finish(runId, result)` が `result.json` を書く

ステップ6と7は `finally` で必ず実行する。シナリオが例外を投げてもコンテキストが漏れないようにする。

**終了時**: `SIGTERM` / `SIGINT` を受けたら新規リクエストの受付を止め、実行中のシナリオの完了を最大30秒待ち、`provider.close()` でブラウザを閉じてからプロセスを終了する。

## エラーハンドリング

- **リクエストバリデーション** — `@hono/zod-openapi` の `defaultHook` で一元的に `400` を返す。各ルートで書かない。
- **シナリオ内の例外** — runnerが捕捉し、`status: "failed"` と `error: { message, stack }` に変換する。プロセスは落とさない。
- **タイムアウト** — `SCENARIO_TIMEOUT_MS` を超えたら `failed` にする。コンテキストは `finally` で確実に閉じる。
- **ブラウザの調達失敗** — `acquireContext()` が投げたら `failed` にする。ブラウザプロセスが死んでいる場合は次回の `acquireContext()` で再起動を試みる。
- **未捕捉の例外 / Promise rejection** — ログに出してプロセスを終了させる。中途半端な状態で走り続けさせない。

## テスト

3層に分ける。

**Vitest（ブラウザを起動しない）**
- `queue` — `MAX_CONCURRENCY` を超えて走らないこと、`MAX_QUEUE` 超過を拒否すること
- `RunStore` — Map経由の取得、`result.json` 書き込み後のディスク経由の取得、`result.json` 無しディレクトリが `interrupted` になること、未知IDが `undefined` になること
- `registry` — ID重複で例外を投げること
- ルート生成 — シナリオ2件から4本のルートが生成されること
- OpenAPI出力 — `params` スキーマが `requestBody` に、`result` スキーマがレスポンスの `data` に現れること
- `config` — 必須変数の欠落で例外を投げること
- artifact配信 — `artifacts[]` に無い名前が `404` になること

**@playwright/test（実ブラウザ、`fixtures/demo-app` が対象）**
- `tests/login.spec.ts` が `loginScenario.run()` を `TestScenarioContext` 経由で呼び、成功すること
- `playwright.config.ts` の `webServer` で `fixtures/demo-app` を自動起動する

**結合テスト**
- `tests/api.integration.spec.ts` が `fixtures/demo-app` とAPIサーバの両方を起動し、`POST /scenarios/login/runs` → `GET /scenarios/login/runs/{runId}` のポーリング → `status: "passed"` と `data.userName` を確認する
- 失敗系も1本: 誤ったパスワードで `status: "failed"` になり、`artifacts[]` に `trace.zip` と `failure.png` が含まれること

これにより「同一のシナリオコードが2つの入口から実行できる」ことが、ひな形自身のテストとして担保される。

## 意図的に含めないもの

以下は本ひな形の対象外とする。必要になったシステムで個別に追加する。

- **認証・認可** — APIは無防備に待ち受ける。公開ネットワークに置く場合は、前段のリバースプロキシやネットワークポリシーで保護すること。
- **秘匿パラメータのマスク** — シナリオに渡したパスワード等は `result.json` の `params`、`trace.zip` 内の入力値とソース、標準出力に平文で残る。共有環境で運用する場合は、この点を承知した上で `runs/` のアクセス権を絞ること。
- **リトライ** — シナリオが失敗したらそのまま `failed` を返す。再実行はAPIクライアント側で再POSTする。
- **スケジューリング** — 定期実行の仕組みは持たない。外部のcronから叩く。
- **HTMLレポート** — API経由の実行ではJSONの `steps[]` と `trace.zip` で足りる。`@playwright/test` 経由の実行では標準のHTMLレポートが出る。
- **動画記録** — traceで代替する（前述）。
- **並列実行時のデータ競合対策** — `MAX_CONCURRENCY > 1` にしたときにシナリオ同士が干渉しないことは、利用者が保証する。

## 依存関係の追加

既存の `hono`、`@hono/node-server`、`@hono/zod-openapi`、`@hono/swagger-ui`、`zod` に加えて、

- `playwright` — Library API（`chromium.launch()` / `chromium.connect()`）
- `@playwright/test` — specファイルと `expect`（devDependency）
- `vitest` — coreのユニットテスト（devDependency）
- `ulid` — runIdの生成

`playwright` と `@playwright/test` はメジャー・マイナーバージョンを一致させる必要がある。
