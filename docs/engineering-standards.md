# エンジニアリング共通基準

このファイルは `CLAUDE.md`(Claude Code 向け)と `AGENTS.md`(Codex 向け)の**共通参照先**です。
同じ規則を複数ファイルに重複記載せず、具体的な基準はここに一元化します。

## 言語とランタイム

- 言語: TypeScript(ESM、`"type": "module"`)。
- ランタイム: Node.js 24 系(実行環境=devcontainer に一致。型定義は `@types/node` の都合で
  `^20` を使用しているが、実行時ランタイムの基準は 24)。HTTP は Hono(`@hono/node-server`)、
  OpenAPI は `@hono/zod-openapi`。
- ブラウザ自動化: Playwright(`playwright` / `@playwright/test`)。

## 固定バージョン方針

- **Playwright の npm バージョンと Docker イメージタグは完全一致**させる。`package.json` は
  キャレット(`^`)を付けず固定する(詳細と背景は
  `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` を参照)。
- 依存の更新も Issue → Draft PR → レビューの通常フローに従い、ローカル検証(`npm test` 等)と
  人間のマージ判断は省略しない。CI 必須化は CI 導入後に適用する(CI 導入は推奨する次ステップ)。

## コード規約

- 既存のディレクトリ構成・命名に従う(`src/core`・`src/scenarios`・`src/pages` 等)。
- fork 所有のシナリオ登録は `src/scenarios/index.ts` で行う(upstream の fixtures/demo は残す)。
- 変更は必要最小限。無関係な整形・リファクタを混ぜない。

## 検証コマンド

| 目的 | コマンド |
|---|---|
| 単体テスト | `npm test`(= `vitest run`) |
| ビルド/型チェック | `npm run build`(= `tsc`) |
| E2E(Playwright) | `npm run test:e2e`(= `playwright test`) |

## オフライン・コンテナ運用の制約

- node_modules は外部で `npm ci` → `tar.gz` 化 → オフラインで展開(レジストリ無し)。
- ベースイメージは外部で `docker save` → オフラインで `docker load`。
- 詳細は `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md`。
