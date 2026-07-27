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
4. `fixtures/demo-app/` — **残す**（削除すると upstream merge 衝突を招くため。登録解除は fork 所有の `src/scenarios/index.ts` で行う）
5. `BASE_URL` を対象システムに向ける

## 意図的に含めないもの

認証、秘匿パラメータのマスク、リトライ、スケジューリング、動画記録。
`params`（パスワード含む）は `runs/{runId}/result.json` に平文で残るため、
共有環境では `runs/` のアクセス権を絞ること。

## 開発運用(このテンプレートを開発する場合)

本リポジトリは Issue → Draft PR → Codex 独立レビュー → ユーザー承認 → 実装 → Codex 最終レビュー →
受け入れ → マージ の折衷フローで開発します。詳細は
[`docs/operations/ai-workflow-policy.md`](docs/operations/ai-workflow-policy.md)、
共通基準は [`docs/engineering-standards.md`](docs/engineering-standards.md) を参照してください。

### fork 側での扱い(opt-out)

`CLAUDE.md` / `AGENTS.md` / `docs/operations/ai-workflow-policy.md` などの運用ファイルは
**upstream 所有・default-on** です。fork でこの運用を使わない場合は、これらを**削除・編集せず**
(upstream merge 衝突を避けるため)、リポジトリ直下に fork 所有の **`FORK.md`** を作成して
自システムの運用を記述してください。`FORK.md` があるとテンプレート運用指示は無効化されます。

## パス所有権(テンプレート運用)

このリポジトリは「テンプレート + upstream merge」方式で運用する。fork(システムごとの複製)は
テンプレート由来の共通修正を `git merge` で継続的に取り込む前提のため、どのパスをどちらが
編集してよいかを以下のとおり定める。

| 所有 | パス |
|---|---|
| テンプレート(共通)所有 | `src/core/`, `Dockerfile`, `.dockerignore`, `deploy/base/`, `scripts/`, `package.json`, `tsconfig.json`, `playwright.config.ts`, `vitest.config.ts`, `docs/` |
| システム(fork 側)所有 | `src/pages/`, `src/scenarios/`, `tests/`, `deploy/overlays/<system>/` |
| 共有(参照のみ・削除しない) | `fixtures/demo-app/`, サンプルの pages/scenarios/spec |

ルール:

- fork 側はテンプレート所有パスを**修正しない**。修正が必要な場合はテンプレートに PR を出し、
  upstream merge で受け取る。
- `package.json` はテンプレート所有だが、fork 固有の依存追加は許容する(衝突時は fork 側で
  手動解決。頻度は低い想定)。
- `fixtures/demo-app/` は**削除しない**(削除すると upstream merge で modify/delete 衝突が
  発生するため)。サンプルシナリオの登録解除は fork 所有の `src/scenarios/index.ts` の編集で
  行う(衝突しない)。

### fork の共通部分取り込み手順

```bash
# 初回(fork 直後)
git remote add upstream <社内Gitのテンプレートrepo URL>

# 共通修正の取り込み(開発時。= fetch + merge upstream/main)
scripts/sync-upstream.sh

# リリース時は再現性のためタグを指定して merge
scripts/sync-upstream.sh template-vX.Y.Z
```

`scripts/sync-upstream.sh` は upstream が未登録なら案内を表示して終了する。引数なしは
`upstream/main` を、引数ありはそのタグ/ブランチを merge する。衝突した場合は上記の所有権表を
参照し、テンプレート所有パスの変更は取り込み、fork 所有パスの変更は手動で解決すること。

## E2E の実行方法(fork 視点)

`playwright.config.ts` はテンプレート所有だが、`BASE_URL` 環境変数を尊重する作りになっている。

```bash
BASE_URL=<自システムのURL> npm run test:e2e
```

`BASE_URL` を指定すると `tests/`(fork 所有)配下の spec のみが実行され、demo-app の起動や
デモ spec の実行は行われない。デモ spec は `examples/e2e/` に分離されており、`BASE_URL` 未指定
(=デフォルトの `npm run test:e2e`)のときだけ demo-app を起動して実行される。

## オフライン/デプロイ

- オフライン環境向けの Docker ビルド手順(バージョン整合の原則、`vendor/` への持ち込み方法など)は
  [`docs/offline-build.md`](docs/offline-build.md) を参照。
- OpenShift(rootless / restricted-v2 SCC)へのデプロイ手順は
  [`docs/deploy-openshift.md`](docs/deploy-openshift.md) を参照。
