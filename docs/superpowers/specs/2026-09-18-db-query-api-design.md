# DB データ取得 API(名前付きクエリ)設計

日付: 2026-09-18
状態: **ドラフト(主要判断はユーザー確認済み 2026-09-24。Codex 設計レビュー → ユーザー設計承認待ち)**

## 背景と目的

本リポジトリは Playwright シナリオを HTTP API で実行するひな形であり、テスト対象システムごとに
fork して使う。E2E テストでは「画面操作の結果が DB にどう反映されたか」「テストデータの前提状態が
どうなっているか」を確認したくなるため、**テスト対象システムの DB からデータを取得する API** を
同じサーバに追加する。

要件:

1. ひな形として `src/core/` に骨格を持ち、fork 側はシステム固有の SQL を追加するだけで API が増える
   (シナリオと同じ「定義を1つ足すと OpenAPI が増える」体験)
2. DB は **本番 = Oracle、開発 = SQLite** を想定し、同じクエリ定義を両方で実行できる
3. 既存のオフライン Docker / OpenShift 運用(`docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md`)
   の制約を壊さない(ネイティブ依存・外部ネットワーク参照を増やさない)

## 中心となる設計判断

**クエリ定義が唯一の実体であり、SQL はリクエストではなくコードに置く。**

```
POST /queries/{id}  ─→  QueryDefinition (params zod → SQL + binds) ─→ DbProvider ─→ rows
                                                                       ├─ SqliteProvider (node:sqlite)
                                                                       └─ OracleProvider (oracledb thin)
```

シナリオが `defineScenario` で定義され `src/scenarios/index.ts` に登録されるのと対称に、
クエリは `defineQuery` で定義され `src/queries/index.ts` に登録される。API クライアントから
受け取るのは **バインド変数の値だけ** で、SQL 文字列そのものは受け取らない。

- **任意 SQL を受け付ける `POST /sql` は作らない**。認証を持たない本サーバで任意 SQL を許すと
  DB 全体の読み出し口になる。SQL をコードに置けばレビュー対象になり、OpenAPI で入力・出力の型も
  公開できる。
- **同期応答**とし、シナリオのような run/queue モデルは採らない。DB クエリはミリ秒〜秒で終わり、
  アーティファクト(スクリーンショット・trace)も無い。runId のポーリングは利用者の手間を増やす
  だけである。長時間クエリはタイムアウトで打ち切る。
- **読み取り専用**。UPDATE / DELETE / DDL は対象外(「意図的に含めないもの」参照)。

## API

| メソッド・パス | 説明 |
|---|---|
| `GET /queries` | クエリ一覧(id, summary, tags) |
| `POST /queries/{id}` | バインド変数を JSON で受け取り、同期的に実行して行を返す |

`POST /queries/{id}` のレスポンス:

```jsonc
// 200
{
  "queryId": "products",
  "rowCount": 2,
  "durationMs": 12,
  "rows": [ { "id": 1, "name": "りんご", "price": 120 }, ... ]   // 型は定義側の row スキーマ
}
```

| ステータス | 条件 |
|---|---|
| `200` | 実行成功。行が0件でも `200`(`rows: []`) |
| `400` | `params` スキーマ違反(既存の `defaultHook` と同じ形 `{ error: { message } }`) |
| `500` | DB エラー(接続失敗・SQL エラー)、返却行が `row` スキーマに違反、または行数が上限超過(「結果行数の上限」参照) |
| `503` | DB が未設定(`DB_DIALECT` 未指定)のとき |
| `504` | `DB_QUERY_TIMEOUT_MS` 超過(接続プール待ちを含む。Oracle のみ) |

シナリオ API と同じく、クエリごとに個別のパスを生成する。OpenAPI 上でリクエストボディが
そのクエリの `params` スキーマ、レスポンスの `rows` が `z.array(row)` になり、Swagger UI から
入力フォームつきで実行できる。

シナリオと異なり **DB エラーは HTTP エラー(500)として返す**。シナリオの失敗は「テスト結果」
だが、クエリの失敗は「API が仕事をできなかった」であり、呼び出し側が結果として扱う情報がない。

## クエリ定義

```ts
// src/queries/products.ts (fork 所有・サンプル)
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
```

```ts
// src/core/db/query.ts (テンプレート所有)
export type Dialect = 'sqlite' | 'oracle'

export interface QueryDefinition<P extends z.ZodType, R extends z.ZodType> {
  id: string
  summary: string
  tags: string[]
  params: P                                   // バインド変数(リクエストボディ)
  row: R                                      // 1行の型(レスポンス rows[] の要素)
  sql: string | ({ default: string } & Partial<Record<Dialect, string>>)
  maxRows?: number                            // 省略時は DB_MAX_ROWS。それを超える値は起動時エラー
}
```

- **バインド変数は `:name` 形式**で統一する。SQLite(`node:sqlite`)と Oracle(`oracledb`)は
  どちらもネイティブに `:name` をサポートするため、多くのクエリは1つの SQL で両方に通る。
- 方言差(`FETCH FIRST` / `LIMIT`、日付関数など)が避けられない場合だけ `sql` をオブジェクトにし、
  `{ default, oracle?, sqlite? }` で上書きする。上書きが無い方言は `default` を使う。
- `params` のキーとバインド名は一致させる。SQL 中に現れないキーや、SQL にあって `params` に
  無いバインド名は **起動時に検出して落とす**(`buildQueryRegistry` で SQL から `:name` を抽出し
  `params.shape` のキー集合と照合する。zod object 以外の `params` は許可しない)。
- **列名はエイリアスを二重引用符で明示する**規約とする。Oracle は引用符なし識別子を大文字化して
  返す(`NAME`)が、`AS "name"` と書けば SQLite / Oracle とも同じキーで返る。テンプレート側で
  キーの大文字小文字を変換する魔法は入れない(変換規則自体が方言差の温床になる)。
- 行は `z.array(row)` で検証してから返す。違反は `500`(シナリオが `result` を検証するのと同じ
  姿勢。列名の書き間違いを Swagger の型不一致ではなくエラーとして早期に気づかせる)。
- 定義に任意の `maxRows?: number` を持てる。省略時は `DB_MAX_ROWS`。`DB_MAX_ROWS` を超える値は
  起動時エラー(「結果行数の上限」参照)。

### 結果行数の上限(強制)

fork 側のクエリが絞り込みを忘れた場合に、全行をドライバで配列化 → Zod 検証 → JSON 化して
Pod のメモリ上限を超えるのを防ぐため、**行数上限をテンプレート側で必ず強制する**。

- 上限は `min(定義の maxRows, DB_MAX_ROWS)`。既定 `DB_MAX_ROWS=1000`。
- **どちらも正の有限整数に限る**。`DB_MAX_ROWS` は `config.ts` の zod で
  `z.coerce.number().int().positive()`(既存の `MAX_QUEUE` 等と同じ)、定義の `maxRows` は
  `buildQueryRegistry` で `Number.isSafeInteger(v) && v > 0` を検査する。`0`・負数・小数・`NaN`・
  `Infinity` は起動時エラー(ドライバエラーや「全クエリが上限超過」を実行時まで持ち越さない)。
- 定義で `DB_MAX_ROWS` より大きい値を指定した場合も `buildQueryRegistry` が起動時に落とす
  (設定側の上限を定義で迂回できない)。
- Provider は **`maxRows + 1` 件まで**しか取得しない(Oracle は `execute` の `maxRows` オプション、
  SQLite は `iterate()` を `maxRows + 1` 件で打ち切る)。`maxRows + 1` 件目が存在したら
  **`500` `{ error: { message: "row limit exceeded (maxRows=N)" } }`** を返し、行は返さない
  (黙って切り詰めると呼び出し側が全件と誤認するため)。
- 上限に収めるのはクエリ側の責務(`WHERE` で絞る、`FETCH FIRST n ROWS ONLY` を書く)。
  ページングは引き続き対象外。
- テスト: SQLite で `maxRows` ちょうどは `200`、`maxRows + 1` 行あると `500`、定義の `maxRows` が
  `DB_MAX_ROWS` を超える・`0`・負数・小数・`NaN` のいずれも起動時エラー。`DB_MAX_ROWS=0` /
  `abc` / `1.5` で `loadConfig` が落ちる。

### レジストリ

`buildQueryRegistry(queries)` は `buildRegistry` と同じく id 重複を起動時に落とし、加えて次を検証する:

- SQL がコメント・空白を除いて `SELECT` または `WITH` で始まること(読み取り専用の意思表示。
  Oracle 側の権限で本来担保するが、定義ミスを起動時に検出する)
- 前述のバインド名と `params` キーの整合
- 定義の `maxRows` が正の有限整数かつ `DB_MAX_ROWS` 以下であること

## DbProvider 抽象

```ts
// src/core/db/provider.ts
export interface DbProvider {
  readonly dialect: Dialect
  query(sql: string, binds: Record<string, unknown>, opts: { timeoutMs: number; maxRows: number }): Promise<Record<string, unknown>[]>
  // maxRows + 1 件目が存在すれば RowLimitExceededError を投げる(呼び出し側で 500 に写像)
  close(): Promise<void>
}
export function createDbProvider(config: Config): DbProvider | null   // DB_DIALECT 未設定なら null
```

`BrowserProvider` と同じ「起動時に1つ作り、ルートに注入し、shutdown で閉じる」形にする。

### シャットダウン時の drain

既存の `src/index.ts` の shutdown は `server.close()` → `queue.drain()`(上限 30 秒)→
`provider.close()` の順で、ブラウザジョブしか待たない。DB クエリの実行中に SIGTERM を受けると、
使用中の Oracle 接続を切るか `pool.close()` が失敗して処理中の HTTP 応答が失われるため、
次のとおり `DbProvider.close()` に drain を組み込む。

- `OracleProvider.close()` は **`pool.close(DB_SHUTDOWN_DRAIN_S)`**(既定 `10` 秒)を呼ぶ。
  node-oracledb はこの間、新規 `getConnection()` を拒否しつつ使用中の接続の継続を許し、経過後に
  強制クローズする(公式ドキュメントの `drainTime` の挙動)。実行中クエリは
  `DB_QUERY_TIMEOUT_MS` で必ず終わるため、実効的な待ち時間は `min(DB_SHUTDOWN_DRAIN_S,
  残クエリ時間)`。active-query カウンタは持たない(プールの drain で足りる)。
- `SqliteProvider.close()` は `db.close()` のみ。実行が同期のため、`await` をまたぐ処理中クエリは
  存在しない。
- `src/index.ts` の shutdown 順序は `server.close()` → `queue.drain()` → `provider.close()` →
  **`db?.close()`** → `process.exit(0)`。DB の drain はブラウザの drain と並行させず直列にする
  (合計上限は 30 + `DB_SHUTDOWN_DRAIN_S` 秒)。**`deploy/base/deployment.yaml` に
  `terminationGracePeriodSeconds: 60` を設定する**(「デプロイ(OpenShift)」参照)。現状の
  manifest は未設定で Kubernetes 既定の 30 秒のため、ブラウザの drain だけで猶予を使い切ると
  `db.close()` に到達する前に Pod が強制終了される。
- テスト(`oracledb` モック): `close()` が `pool.close(drainTime)` を `DB_SHUTDOWN_DRAIN_S` で
  呼ぶこと、`close()` 後の `query()` が `503` 相当のエラーになること。

### SqliteProvider(開発用)

- **`node:sqlite`(Node 組み込み)** を使う。追加依存ゼロで、ネイティブモジュールのビルドも
  プリビルドバイナリの取得も不要。オフライン成果物パイプライン(`vendor/node_modules.tar.gz`)に
  プラットフォーム依存物を持ち込まない。
- `new DatabaseSync(file, { readOnly: true })` で開く。**`:memory:` は許可しない**。読み取り専用の
  `:memory:` には seed を書けず、別接続で開いた `:memory:` は内容を共有しない(検証済み:
  `attempt to write a readonly database` / `no such table`)ため、常に空の DB になる。
- **テストは「seed 済み一時ファイルを readOnly で開き直す」方式**で行う。`fixtures/demo-db/seed.ts`
  は `seedSqlite(file)` 関数をエクスポートし、テストはこれで一時ディレクトリにファイルを作ってから
  `SqliteProvider` に渡す(`DatabaseSync` インスタンスの注入は行わず、Provider は常に readOnly で
  自分で開く。書き込み可能な接続が製品コードの経路に入らないようにする)。
- 実行は同期(イベントループをブロックする)。開発用途で行数も小さい前提なので許容する。
  `timeoutMs` は SQLite では適用しない。行の取得は `db.prepare(sql).iterate(binds)` で
  `maxRows + 1` 件まで読んで打ち切る(「結果行数の上限」参照)。
- `node:sqlite` は Node 22.13+ で無フラグ利用可だが実行時に `ExperimentalWarning` が出る。
  `dev` スクリプトに `--no-warnings=ExperimentalWarning` を付けるかは実装時に判断(本番は Oracle
  想定のため警告は出ない)。
- **`@types/node` を `^22` へ更新**する(`node:sqlite` の型定義のため)。`docs/engineering-standards.md`
  の「型定義は `^20`」の記述を更新する。

### OracleProvider(本番用)

- **`oracledb`(node-oracledb)の Thin モード**を使う。Thin モードは pure JavaScript で
  Oracle Instant Client を必要とせず、ベースイメージ(Playwright 公式 noble)に何も足さずに動く。
  `npm ci` → `tar.gz` のオフライン手順もそのまま使える。
- 接続プール(`oracledb.createPool`)を起動時に作る。`poolMin=0`, `poolMax=DB_POOL_MAX`(既定 `2`)。
  起動時には **接続を試みない**(DB 停止中でも API サーバは起動し、クエリ時に `500` を返す)。
  ヘルスチェック `/health` も DB を見ない(Pod の生死と DB の生死を分ける)。
- **接続取得から実行完了までを単一の期限(deadline = 開始時刻 + `DB_QUERY_TIMEOUT_MS`)で管理**する。
  - プール作成時に `queueTimeout = DB_QUERY_TIMEOUT_MS` を設定する(`poolMax` を使い切った状態での
    `pool.getConnection()` 待ちがこの時間で `NJS-040` として失敗する。既定の 60 秒のままにしない)。
  - **接続取得も同じ期限で打ち切る**。`queueTimeout` が制限するのは `poolMax` 飽和時のキュー待ち
    だけで、`poolMin=0` の空き枠に対する最初の `getConnection()` は物理接続(DNS / TCP / Oracle
    Net)の確立を伴い、DB 停止や通信遮断時はこれが長引く。そこで `pool.getConnection()` も
    残り時間のタイマーと `Promise.race` し、期限到来なら `504` を返す。**期限後に遅れて解決した
    接続は必ず `close()` してプールへ返す**。孤児化した `getConnection()` の Promise には
    `.then(c => c.close()).catch(err => log)` を付け、**取得失敗(遅延 reject)と `close()` 失敗の
    双方を必ず catch してログに記録する**。既存の `src/index.ts` は `unhandledRejection` で
    `process.exit(1)` するため、catch 漏れは API サーバ全体の停止につながる。あわせて Thin モードの `connectTimeout`(秒)をプール設定で
    `ceil(DB_QUERY_TIMEOUT_MS / 1000)` に設定するが、これは防御であり契約の根拠にはしない。
  - 接続取得後、残り時間 `remaining = deadline - now` を再計算(0 以下なら実行せずタイムアウト
    扱い)→ `execute(sql, binds, { outFormat: OBJECT, maxRows: limit + 1, fetchArraySize:
    limit + 1 })` → `close()`(`finally` で必ず返却)。
    **ドライバに渡す `maxRows` は必ず論理上限 `limit` に 1 を足した値**とする。node-oracledb の
    `maxRows` は超過分を黙って切り詰める(公式ドキュメント: "The number of rows returned is
    limited by maxRows")ため、`limit` をそのまま渡すと `limit + 1` 件目を観測できず、欠落した
    結果を `200` で返してしまう。返却行数が `limit` を超えていれば `RowLimitExceededError`。
  - **期限の強制は Provider 側の外側タイマーで行う**。`callTimeout` は「各往復に個別に適用され、
    往復の合計には適用されない」(公式ドキュメント)ため、単一期限の契約を満たす手段にならない。
    `execute` を `remaining` ミリ秒のタイマーと `Promise.race` し、期限到来時は
    `connection.break()` で実行中の文を中断してから接続を返却し、`504` を返す。`break()` が
    効かず `execute` が戻らない場合に備え、接続の返却は `connection.close({ drop: true })` で
    プールから破棄する。`callTimeout = remaining` も併せて設定するが、これは往復単位の
    防御(defense in depth)であり、契約の根拠にはしない。
  - プール待ちのタイムアウト(`NJS-040`)、接続取得・実行いずれの外側タイマーの期限到来、
    `callTimeout` 超過はいずれも `504` に写像する。それ以外の DB エラー(接続確立の即時失敗を
    含む)は `500`。
  - テスト(`oracledb` モック):
    - `poolMax` 飽和時に後続リクエストが `DB_QUERY_TIMEOUT_MS` 以内に `504` で返ること
    - `getConnection()` が解決しない(接続確立が停止した)場合に `DB_QUERY_TIMEOUT_MS` 以内に
      `504` で返ること。期限後に遅れて解決した接続に対して `close()` が呼ばれること
    - 期限後に `getConnection()` が遅延 reject した場合、および遅延解決後の `close()` が reject
      した場合に、unhandled rejection が発生せず(`process.on('unhandledRejection')` をテスト内で
      監視)ログに記録されること
    - `execute` に `maxRows: limit + 1` が渡され、`limit + 1` 行返ると `RowLimitExceededError`
      (→ `500`)、`limit` 行ちょうどなら成功すること
    - `execute` が個々の往復では `callTimeout` 未満だが合計で期限を超える(モックで `execute` の
      解決を `remaining` より遅らせる)場合に、期限で `break()` が呼ばれ `504` になること
    - `callTimeout` が残り時間で設定されること
- 読み取り専用は **DB ユーザーの権限で担保**する(SELECT 権限のみのアカウントを用意する旨を
  ドキュメントに書く)。`autoCommit` は既定の `false` のまま、コミットは呼ばない。
- **バージョンと対応 DB**(2026-09-18 時点の npm 最新は `oracledb@7.0.1`、6 系最新は `6.10.0`):
  - `^7` — Oracle Database **19c 以降**のみ(19 未満との接続は 6.10 で非推奨、7.0 で削除)。
  - `^6.10` — Oracle Database 12.1 以降(19 未満は非推奨扱いだが接続可)。
  - 本 spec は **`^7` を採用し、対象 DB は 19c 以降を前提**とする(ユーザー確認済み:対象システムの
    Oracle は 19c 以降)。いずれも Thin モードが既定で、Thick モードへの切替は「意図的に含めないもの」参照。
- 本テンプレートの CI・devcontainer には Oracle が無いため、`OracleProvider` の自動テストは
  `oracledb` モジュールをモックした単体テスト(バインドの受け渡し・`callTimeout` の設定・
  `close()` の保証)に留め、実 DB での動作確認はユーザー環境で行う(受け入れ条件参照)。

### 方言の切替

`DB_DIALECT` で1つを選ぶ。1プロセスが同時に複数の DB を持つ構成は採らない(fork 1つ = 対象
システム1つ = DB 1つ)。

## 設定

| 変数 | 既定値 | 説明 |
|---|---|---|
| `DB_DIALECT` | (未設定) | `sqlite` \| `oracle`。未設定なら DB 機能は無効(`POST /queries/*` は `503`) |
| `DB_SQLITE_FILE` | (sqlite 時必須) | SQLite ファイルパス(読み取り専用で開く。`:memory:` は不可) |
| `DB_ORACLE_USER` | (oracle 時必須) | 接続ユーザー(SELECT 権限のみ推奨) |
| `DB_ORACLE_PASSWORD` | (oracle 時必須) | パスワード(OpenShift では Secret から注入) |
| `DB_ORACLE_CONNECT_STRING` | (oracle 時必須) | `host:port/service_name` 形式の Easy Connect 文字列 |
| `DB_POOL_MAX` | `2` | Oracle 接続プール上限 |
| `DB_QUERY_TIMEOUT_MS` | `30000` | 1クエリの上限。接続プール待ち + 実行の合計(Oracle のみ有効) |
| `DB_MAX_ROWS` | `1000` | 1クエリが返せる最大行数(正の整数)。超過は `500`。定義の `maxRows` はこれ以下に限る |
| `DB_SHUTDOWN_DRAIN_S` | `10` | 終了時に使用中の Oracle 接続の完了を待つ秒数(`pool.close(drainTime)`) |

`config.ts` の zod スキーマで **方言ごとの必須項目を条件付きで検証**する(`DB_DIALECT=oracle`
なのに `DB_ORACLE_USER` が無い、は起動時に落とす)。`DB_DIALECT` 未設定は正常(DB を使わない
fork を許す)。

**クエリが登録されているのに `DB_DIALECT` 未設定** の場合は起動時エラーにせず `503` で応える。
理由: テンプレートにはサンプルクエリが同梱されるため、DB を使わない fork が `BASE_URL` だけで
起動できなくなるのを避ける。サンプルの登録解除は fork 所有の `src/queries/index.ts` で行う
(シナリオの demo と同じ扱い)。

## サンプルとテストデータ

- `fixtures/demo-db/seed.sql` — `products` テーブルの DDL と数行の INSERT(demo-app の商品一覧と
  対応させる)。SQLite / Oracle 双方で通る最小限の SQL に留める(型は `INTEGER` / `TEXT` 相当)。
- `fixtures/demo-db/seed.ts` — `seed.sql` を SQLite ファイルへ流し込む `seedSqlite(file)` を
  エクスポートし、CLI としても使える小スクリプト。`npx tsx fixtures/demo-db/seed.ts ./demo.sqlite`
  で開発用 DB を作る(生成物は gitignore)。テストも同じ関数で一時ファイルを作る。
- `src/queries/products.ts` — 前掲のサンプルクエリ。`src/queries/index.ts` に登録。
- README クイックスタートに `DB_DIALECT=sqlite DB_SQLITE_FILE=./demo.sqlite` を追記する。

`fixtures/demo-db/` は `fixtures/demo-app/` と同じく **fork 側で削除しない**(共有・参照のみ)。

## ディレクトリ構造(追加分)

```
src/core/db/
  provider.ts        DbProvider インターフェース + createDbProvider
  sqlite.ts          SqliteProvider (node:sqlite)
  oracle.ts          OracleProvider (oracledb thin)
  query.ts           QueryDefinition / defineQuery / buildQueryRegistry / SQL 検査
src/core/http/routes/queries.ts   GET /queries, POST /queries/{id}
src/queries/         ← fork 所有
  index.ts
  products.ts        サンプル
fixtures/demo-db/    ← 共有(削除しない)
  seed.sql
  seed.ts
```

`README.md` のパス所有権表に `src/queries/`(fork 所有)と `fixtures/demo-db/`(共有)を追加する。

## デプロイ(OpenShift)

- `deploy/overlays/example/configmap.yaml` に `DB_DIALECT` / `DB_ORACLE_CONNECT_STRING` /
  `DB_ORACLE_USER` の見本を追加(コメントアウトで opt-in)。
- パスワードは `Secret` から `DB_ORACLE_PASSWORD` として注入する。`deploy/base/deployment.yaml` に
  `envFrom.secretRef`(`optional: true`)を追加し、overlay 側に `secret.yaml` の**見本**
  (値は placeholder)を置く。実値はクラスタ側で作成する旨を `docs/deploy-openshift.md` に書く。
- **`deploy/base/deployment.yaml` の `spec.template.spec` に `terminationGracePeriodSeconds: 60`
  を追加する**。内訳: `queue.drain()` 上限 30 秒 + `DB_SHUTDOWN_DRAIN_S` 既定 10 秒 +
  `provider.close()` / プロセス終了の余裕 20 秒。overlay 側で `DB_SHUTDOWN_DRAIN_S` を増やす場合は
  `terminationGracePeriodSeconds` も `30 + DB_SHUTDOWN_DRAIN_S + 20` 以上に上書きする旨を
  `docs/deploy-openshift.md` に書き、example overlay にコメントで併記する。
  検証: `kubectl kustomize deploy/overlays/example` の出力に `terminationGracePeriodSeconds: 60`
  が含まれること(既存の Phase 3 検証コマンドに追加)。
- Docker イメージへの追加は不要(`oracledb` Thin は pure JS、`node:sqlite` は Node 組み込み)。
  ただし **ベースイメージ同梱の Node が 22.13 以上であること**を実装時に確認する(Playwright
  `v1.61.1-noble` の Node バージョン)。満たさない場合は SQLite を開発専用と割り切りコンテナでは
  Oracle のみとするか、`better-sqlite3` へ差し替えるかを設計レビューに戻して決める。

## テスト

| 対象 | 方法 |
|---|---|
| `SqliteProvider` | `seedSqlite()` で一時ファイルを作り readOnly で開く。バインド・0件・SQL エラー・書き込み拒否・`maxRows + 1` 行で `RowLimitExceededError` を確認 |
| `buildQueryRegistry` | id 重複、非 SELECT 文、バインド名と `params` の不整合、`maxRows` が非正・非整数・`NaN`・`DB_MAX_ROWS` 超過、を起動時に落とす |
| `config` | `DB_MAX_ROWS` / `DB_SHUTDOWN_DRAIN_S` の無効値(`0`、負数、小数、文字列)で `loadConfig` が落ちる |
| `OracleProvider` | `oracledb` をモックし、pool 取得 → `callTimeout` 設定 → `execute(maxRows: limit + 1)` → close(`finally`)の順序、`NJS-040` / 接続取得の期限到来(遅延解決した接続の `close()`、遅延 reject と `close()` 失敗が unhandled にならないこと)/ 実行の期限到来(`break()` 呼出)/ `callTimeout` の `504` 写像、`limit + 1` 行で `RowLimitExceededError`、`poolMax` 飽和時に上限時間内で `504`、`close()` が `pool.close(DB_SHUTDOWN_DRAIN_S)` を呼ぶことを確認 |
| ルート(`app.test.ts` 拡張) | seed 済み一時 SQLite で `200`(行あり/0件)、`400`、`500`(行スキーマ違反・行数上限超過)、`503`(未設定)、OpenAPI にパスが出る |
| 結合(`api.integration.test.ts`) | `seedSqlite()` で一時ファイルを seed → その path を `DB_SQLITE_FILE` にしてサーバ起動 → `POST /queries/products` の end-to-end(Provider は readOnly で開くため seed が先。単体テストと同じ順序) |
| E2E(`playwright test`) | 変更なし(既存 2 件が green のまま) |

## 開発フェーズ

| # | フェーズ | 完了条件 |
|---|---|---|
| 1 | DB 抽象 + SQLite + 設定(`src/core/db/`, `config.ts`, `@types/node` 更新) | `npm test` green、新規ユニット追加 |
| 2 | クエリ定義・レジストリ・HTTP ルート・サンプル・seed | Swagger UI から `products` を実行できる。ルート/結合テスト green |
| 3 | Oracle Provider | モックテスト green。ユーザー環境の Oracle で `products` 相当が `200` |
| 4 | ドキュメント・デプロイ(README、offline-build、deploy-openshift、`deployment.yaml` の `terminationGracePeriodSeconds` / `secretRef`、overlay、engineering-standards) | レビュー。`kubectl kustomize deploy/overlays/example` に `terminationGracePeriodSeconds: 60` が含まれる |

## 意図的に含めないもの(YAGNI)

- **任意 SQL の実行 API**(前述)。必要なら fork 側で自己責任で追加する。
- **書き込み(INSERT/UPDATE/DELETE/DDL)**。テストデータの投入は別の仕組み(既存のバッチ・
  マイグレーション)で行う。将来必要になれば `defineCommand` として別 API で設計する。
- **シナリオからの DB アクセス(`ctx.db`)**。ユーザー確認済み:シナリオから DB クエリは実行しない。
  本 spec は HTTP API のみを確立する。将来必要になれば別 spec で扱う(`DbProvider` は
  再利用できる形にしておく)。
- **複数 DB / 複数方言の同時接続**。
- **Oracle Thick モード**(Instant Client 同梱)。Thin モードの対応範囲外の DB や Thick 限定機能が
  必要になったときに個別対応する。
- **ページング・ストリーミング**。大量行はクエリ側で絞る(`FETCH FIRST n ROWS ONLY` 等)。
  上限超過は「結果行数の上限」のとおりエラーにする(黙って切り詰めない)。
- **結果のキャッシュ・保存**。`runs/` には残さない(DB 内容の平文コピーを増やさない)。
- **認証**。既存方針どおり(OpenShift では Route を opt-in にし、ネットワークで守る)。
  DB データはシナリオ結果より機微である可能性が高いため、README の注意書きにその旨を追記する。

## 依存関係の追加

| パッケージ | 種別 | 理由 |
|---|---|---|
| `oracledb` `^7` (7.0.1) | dependencies | Oracle 接続(Thin モード、pure JS)。対象 DB は 19c 以降 |
| `@types/node` `^22` (22.20.3) | devDependencies(更新) | `node:sqlite` の型定義。ランタイム基準(Node 24)に合わせ `^24` (24.13.5) でも可 |

`node:sqlite` は Node 組み込みのため依存追加なし。固定バージョン方針(`docs/engineering-standards.md`)は
Playwright にのみ適用されており、`oracledb` はキャレット付きで良い(Docker イメージタグとの整合
要件が無い)。

## 確定済みの設計判断(ユーザー確認 2026-09-24)

1. 任意 SQL の実行 API は作らない。SQL はコードに置く名前付きクエリ方式
2. 同期応答(run/queue モデルは採らない)
3. SQLite ドライバは `node:sqlite`(Node 組み込み)
4. 対象システムの Oracle Database は 19c 以降 → `oracledb ^7`
5. シナリオからの DB 参照(`ctx.db`)は行わない。本 spec は HTTP API のみ

## 未決事項

1. Playwright `v1.61.1-noble` イメージ同梱の Node バージョン(22.13 以上か)。実装時に確認し、
   満たさなければ設計レビューへ戻す
