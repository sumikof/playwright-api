# 引き継ぎ書 — オフライン/Docker/OpenShift 対応とテンプレート運用

最終更新: 2026-07-24

## 1. 何をしているか

Playwright E2E API サーバひな形(本体は実装済み・テスト green)に対する**次の開発**:

1. オフライン環境対応(CDN 依存の排除)
2. Dockerfile 作成(オフラインビルド前提)
3. rootless OpenShift(restricted-v2 SCC)用 manifest
4. fork 運用における共通部分の管理方針(テンプレート + upstream merge)

**設計スペックは `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md`。**
ブレインストーミング完了・全セクションユーザー承認済み・コミット済み(`eea8ce4`)。

ひな形本体の設計は `docs/superpowers/specs/2026-07-09-playwright-e2e-api-server-design.md`、
実装計画は `docs/superpowers/plans/2026-07-10-playwright-e2e-api-server.md`(実装完了)。

## 2. 現在地

| フェーズ | 状態 |
|---|---|
| ブレインストーミング(今回分) | 完了・ユーザー承認済み |
| 設計スペックの作成とコミット | 完了(`eea8ce4`) |
| **実装計画の作成(writing-plans)** | **未着手 ← ここから再開** |
| 実装(Phase 1〜4) | 未着手 |

## 3. ユーザーと確定した前提(スペックにも記載あり)

- **node_modules 調達**: 外部の npm 実行環境で `npm ci` → `tar.gz` 化してファイル保管 →
  Docker ビルド時に展開(オフライン側に npm レジストリは無い)
- **ベースイメージ**: Playwright 公式イメージを外部で `docker save` → オフライン側で `docker load`
- **社内 Git サーバあり**(fetch/merge 可能)
- **成果物保持**: emptyDir で十分(Pod 再起動で消えてよい)
- **共通管理方式**: 案A = このリポジトリをテンプレートとして各システムが fork、
  `git fetch upstream && git merge` で取り込み。タグ `template-vX.Y.Z` をリリース時に merge

## 4. スペックの要点(実装時に効く判断)

詳細はスペックを読むこと。骨子:

- **Playwright の npm バージョンとイメージタグは完全一致**(package.json をキャレットなしに固定)
- **CDN 排除のコード修正は2点**:
  - `src/core/http/app.ts:32` の `swaggerUI()` が jsdelivr CDN 参照 → `swagger-ui-dist` を
    依存に追加し `/ui/assets/*` で自前配信、`@hono/swagger-ui` は依存から削除
  - `BROWSER_LAUNCH_ARGS` 環境変数を新設(`src/core/config.ts` + `src/core/browser/local.ts`)。
    コンテナ既定は `--no-sandbox`(OpenShift の任意 UID では Chromium サンドボックス不可)
- **Dockerfile**: 2ステージ、`vendor/node_modules.tar.gz` を展開してビルド、prune しない、
  `USER` 固定せず `chgrp -R 0 && chmod -R g=u`、`HOME=/tmp`
- **manifest**: `deploy/base`(共通)+ `deploy/overlays/example`(システム別見本)の Kustomize。
  `runAsUser` は書かない。runs と /tmp は emptyDir。probes は `/health`
- **README 方針変更**: 「fixtures/demo-app は削除する」→「残す」(fork 側で削除すると
  upstream merge 時に modify/delete 衝突するため。登録解除は fork 所有の
  `src/scenarios/index.ts` で行う)
- **開発フェーズ**: ①CDN 排除 → ②Docker → ③OpenShift → ④テンプレート運用
  (各フェーズの完了条件はスペックの表を参照)

## 5. リポジトリと環境の状態

- ブランチ: `main`、先頭 `eea8ce4`(origin/main より **1コミット先行、push 未実施**)
- 一度 PR 用ブランチを切ったが、環境制約(下記)で push できず、ユーザー指示で
  main に fast-forward して取り込み、ブランチは削除済み

### 環境の制約(この devcontainer)

- **`ssh` バイナリが無い** → SSH リモート(`git@github.com:...`)へ push 不可
- **`gh` CLI が無い**、`GH_TOKEN` 等も未設定 → PR 作成不可
- push はユーザーがプロンプトで `! git push` を実行する運用

### 注意(事故の記録)

- 2026-07-24 のセッションで `git reset --hard` により、未コミットだった
  `.devcontainer/devcontainer.json` のローカル変更を**誤って破棄した**(復元不能)。
  ユーザーへ報告済み。devcontainer の挙動がおかしい場合はこの変更の消失を疑うこと
- devcontainer には Playwright 用共有ライブラリのローカルフィーチャー
  (`.devcontainer/features/playwright-deps/`)が入っており、ブラウザはコンテナ内で起動できる

## 6. 再開手順

1. `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` を読む
2. **`superpowers:writing-plans` スキルで実装計画を作る。**
   入力はスペック + 本ファイルのセクション4
3. 計画を `docs/superpowers/plans/2026-07-24-offline-docker-openshift.md` に保存してコミット
4. `superpowers:subagent-driven-development` または `superpowers:executing-plans` で実装
5. 各フェーズの検証:
   - Phase 1: `npm test` と `npx playwright test` が green + 新規テスト
     (`/ui` に外部 URL が無いこと、launch args の伝播)
   - Phase 2: `docker build` 成功 → コンテナ起動 → `/health` と demo シナリオ実行
     (この devcontainer に docker があるかは**未確認**。無ければビルド検証は
     ユーザー環境に依頼する)
   - Phase 3: `kubectl kustomize deploy/overlays/example`(または `oc kustomize`)が
     妥当な YAML を出すこと
   - Phase 4: ローカル bare repo を upstream に見立てて `scripts/sync-upstream.sh` を検証

### 実装計画に含めるべきタスクの見取り図(出発点)

| # | タスク | 検証 |
|---|---|---|
| 1 | playwright バージョン完全固定 + `swagger-ui-dist` 依存追加(package.json はユーザーの npm 環境で lock 更新が必要な点に注意) | `npm test` |
| 2 | Swagger UI 自前配信(`/ui` + `/ui/assets/*`)、`@hono/swagger-ui` 削除 | Vitest: 外部 URL 不在 |
| 3 | `BROWSER_LAUNCH_ARGS` を config + LocalBrowserProvider に追加 | Vitest |
| 4 | `scripts/package-deps.sh` + `vendor/` 規約(gitignore) | 手動 |
| 5 | `Dockerfile` + `.dockerignore` | docker build(可能なら) |
| 6 | `docs/offline-build.md`(成果物作成〜持ち込み〜ビルド手順) | レビュー |
| 7 | `deploy/base` 一式 + `deploy/overlays/example` | kustomize build |
| 8 | `docs/deploy-openshift.md` | レビュー |
| 9 | `scripts/sync-upstream.sh` | bare repo で動作確認 |
| 10 | README 更新(所有権表、fork 手順、demo-app「残す」への変更) | レビュー |
