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
