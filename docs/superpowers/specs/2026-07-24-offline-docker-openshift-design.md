# オフライン環境向け Docker / OpenShift 対応とテンプレート運用 設計

日付: 2026-07-24
状態: 承認済み(ブレインストーミングで各セクション承認)

## 背景と目的

本リポジトリは Playwright シナリオを HTTP API で実行するサーバのひな形であり、
テスト対象システムごとに fork(複製)して使う。今回の対応範囲:

1. **オフライン環境**で動かせるようにする(CDN・外部ネットワーク参照の排除)
2. **Dockerfile** の作成(オフラインビルド前提)
3. **rootless な OpenShift**(restricted-v2 SCC 相当)で動く manifest の作成
4. fork 運用における**共通部分の管理方針**の確立

### 確定した前提条件

- node_modules は外部の npm 実行環境で取得し、`tar.gz` にしてファイルシステムに
  保管する。Docker ビルド時に展開して使う(npm レジストリはオフライン側に無い)
- ベースイメージは Playwright 公式イメージ(`mcr.microsoft.com/playwright`)を
  外部で `docker save` し、オフライン側で `docker load` する
- オフライン網内に社内 Git サーバがあり、リポジトリ間の fetch/merge ができる
- 実行成果物(RUNS_DIR)は Pod 再起動で消えてよい → **emptyDir** を使う
- 共通部分の取り込み方式は **A: テンプレートリポジトリ + upstream merge**

## 1. オフライン成果物パイプライン

外部(ネット接続あり)で作成し、ファイルとして持ち込む成果物は3つ。

| 成果物 | 作り方 | 持ち込み先 |
|---|---|---|
| ベースイメージ tar | `docker pull mcr.microsoft.com/playwright:v<X.Y.Z>-noble` → `docker save -o playwright-base.tar` | オフライン側で `docker load` し、必要なら内部レジストリへ push |
| `node_modules.tar.gz` | npm 実行環境で `npm ci` → `tar czf` | ファイルシステム保管。Docker ビルドコンテキストに配置 |
| リポジトリ本体 | git push | 社内 Git サーバ |

### バージョン整合の原則

**package.json の `playwright` / `@playwright/test` のバージョンと、ベースイメージの
タグは完全一致させる。** イメージ内のブラウザは同梱の Playwright バージョンと対に
なっているため、ずれるとブラウザ実行時エラーになる。

- package.json はキャレット指定(`^1.61.1`)をやめ、**完全固定**(`1.61.1`)にする
- 対応表と更新手順を `docs/offline-build.md` に明記する

### 補助スクリプト

- `scripts/package-deps.sh`(外部環境で実行): `npm ci` → `node_modules.tar.gz` 作成、
  ベースイメージの pull/save をまとめて行う
- 生成物の配置場所は `vendor/`(gitignore 対象)に規約化する

## 2. CDN 依存の排除(コード修正)

### 2.1 Swagger UI の自前配信

現状 `src/core/http/app.ts` の `swaggerUI({ url: '/doc' })` は、jsdelivr CDN から
swagger-ui アセットを読む HTML を返すため、オフラインでは `/ui` が機能しない。

対応:

- `swagger-ui-dist` を dependencies に追加(node_modules 経由で持ち込まれる)
- `/ui/assets/*` で `node_modules/swagger-ui-dist` の必要ファイル
  (`swagger-ui.css`, `swagger-ui-bundle.js`, `swagger-ui-standalone-preset.js`)を配信
- `/ui` は自前の HTML を返し、上記ローカルアセットを参照する
- **オンライン validator を無効化する**: `SwaggerUIBundle` の既定は
  `validatorUrl: "https://validator.swagger.io/validator"` で、/ui を開くと spec を外部へ
  POST する。初期化設定で **`validatorUrl: null` を必須**にし、外部通信を断つ
- `@hono/swagger-ui` への依存は削除する
- テスト:
  - `/ui` が返す HTML と初期化スクリプトに外部 URL(他ホストの `http://`/`https://`)が
    含まれず、`validatorUrl: null` が設定されていることを検証するユニットテスト
  - **(必須)** `/ui` をブラウザ(Playwright、既に依存にある)で実描画し、**外部ホストへの
    ネットワーク要求がゼロ**であることを検証するテスト。HTML 静的検査だけでは bundle 実行時の
    validator 通信を捕捉できないため、これを Phase 1 の必須テストとし §6 完了条件にも含める

### 2.2 ブラウザ起動オプションの外部化

OpenShift の任意 UID 実行では Chromium のサンドボックス(user namespace)が使えない。
`BROWSER_LAUNCH_ARGS` 環境変数を追加する。

- `src/core/config.ts` に `BROWSER_LAUNCH_ARGS`(スペース区切り文字列、既定は空)を追加
- `LocalBrowserProvider` が `launch({ headless, args })` に引き渡す
- コンテナでの既定値は Dockerfile 側で `ENV BROWSER_LAUNCH_ARGS="--no-sandbox"` を設定
  (ローカル開発には影響しない)

### 2.3 E2E テスト探索とデモ spec の分離(fork の test:e2e を汚さない)

現状 `playwright.config.ts` は `testDir: './tests'` / `testMatch: '**/*.spec.ts'` で
`tests/login.spec.ts`(デモ)を常に検出し、`baseURL` を `http://localhost:4321` に固定、
`webServer` で demo-app を必ず起動する。`tests/` は fork 所有だが、サンプル spec を「残す」と
fork の標準 `npm run test:e2e` がデモまで実行してしまう(API 側 `src/scenarios/index.ts` の
登録解除は Playwright のテスト探索には無関係)。

対応:

- デモ E2E spec を**通常の testDir 外**へ移す(例: `examples/e2e/login.spec.ts`)、
  または **opt-in の project** として分離し、既定の `npm run test:e2e` では実行しない。
- `playwright.config.ts` を**環境変数駆動**にする: `BASE_URL`(既定はデモの
  `http://localhost:4321`)を受け取り、`webServer` はデモ実行時のみ有効化(例: `BASE_URL`
  未指定かつデモ project 選択時のみ demo-app を起動)。fork は自システムの `BASE_URL` を
  与えて自分の spec だけを回せる。
- 所有権上、`playwright.config.ts` はテンプレート所有だが fork の `BASE_URL` を尊重する
  作りにする(§5 の所有権表と整合)。
- テスト/検証: fork を想定し、`BASE_URL` を与えた `npm run test:e2e` がデモ spec・demo-app を
  起動せず対象のみ実行することを確認する。

## 3. Dockerfile

単一ステージではなくビルド/実行の2ステージ構成。両ステージとも持ち込んだ
Playwright 公式イメージを使う(Node 同梱のため)。

```dockerfile
ARG BASE_IMAGE=mcr.microsoft.com/playwright:v1.61.1-noble
FROM ${BASE_IMAGE} AS build
WORKDIR /app
COPY vendor/node_modules.tar.gz .
RUN tar xzf node_modules.tar.gz && rm node_modules.tar.gz
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc

FROM ${BASE_IMAGE}
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production \
    HOME=/tmp \
    RUNS_DIR=/app/runs \
    BROWSER_LAUNCH_ARGS="--no-sandbox"
RUN mkdir -p /app/runs && chgrp -R 0 /app && chmod -R g=u /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

設計判断:

- `BASE_IMAGE` は ARG で差し替え可能(内部レジストリのタグを指定できる)
- **node_modules は全量同梱**する。`npm prune --omit=dev` はオフラインでの挙動リスク
  (レジストリ照会)を避けるため初版では行わない。イメージサイズより確実性を優先
- **rootless 対応**: `USER` は固定しない(OpenShift が任意 UID を割り当てる)。
  `chgrp -R 0 && chmod -R g=u` で root グループ書き込み可にし、任意 UID + GID 0 で
  動くようにする。`HOME=/tmp` で書き込み可能なホームを保証
- ブラウザは `/ms-playwright` に同梱済み(world-readable)のため追加作業不要
- `.dockerignore` を追加(`node_modules`, `runs`, `test-results`, `dist`, `.git` 等を除外。
  node_modules はホストのものではなく tar.gz から展開したものを使う)

## 4. OpenShift manifest(Kustomize)

`deploy/` 配下に Kustomize の base / overlays 構成を置く。base は共通部分
(upstream merge で更新)、overlay はシステム固有(fork 側が所有)。

```
deploy/
├── base/
│   ├── kustomization.yaml
│   ├── deployment.yaml
│   └── service.yaml         # ClusterIP のみ(外部公開は base に含めない)
└── overlays/
    └── example/            # fork 後にシステム名へコピーして使う見本
        ├── kustomization.yaml   # イメージ名/タグ、replicas、リソース量の patch
        ├── configmap.yaml       # BASE_URL, MAX_CONCURRENCY 等の環境変数
        └── route.yaml           # 外部公開は overlay 側の opt-in(既定では公開しない)
```

### Route(外部公開)を base から外す — 認証なし API の露出防止

この API は**認証を持たない**(README 明記)うえ、実行時 params(パスワード等)が
`result.json` に平文で保存され、成果物 API から取得できる。`route.yaml` を共通 base に含めて
常時適用すると、Route に到達できる誰もがシナリオ実行や機密成果物取得を行えてしまう。

- **base は ClusterIP Service まで**とし、`Route`(外部公開)は base に含めない。
- 外部公開が必要な fork は overlay 側で `route.yaml` を **opt-in** し、少なくとも
  **TLS 終端 + 外部認証プロキシ(または到達元制限)**を前提条件とする。overlay の見本には
  「無認証のまま公開しない」旨と最小の保護例(`tls:`、到達制限の注記)を記載する。
- `docs/deploy-openshift.md` に、公開する場合の必須保護(認証・TLS・到達制限)を明記する。

### deployment.yaml の要点

- **securityContext**(restricted-v2 SCC 準拠):
  - pod: `runAsNonRoot: true`, `seccompProfile: { type: RuntimeDefault }`
  - container: `allowPrivilegeEscalation: false`, `capabilities: { drop: [ALL] }`
  - `runAsUser` / `fsGroup` は**指定しない**(SCC の動的割り当てに任せる)
- **ボリューム**: `RUNS_DIR`(/app/runs)と `/tmp` を emptyDir でマウント
  (readOnlyRootFilesystem は初版では設定しない。ブラウザの書き込み先が多岐に
  わたるため、安定後の強化項目とする)
- **probes**: liveness / readiness とも `GET /health`
- **リソース**: 既定 requests `cpu: 250m / memory: 512Mi`、
  limits `memory: 2Gi`(ブラウザ1プロセス+Node を想定。MAX_CONCURRENCY を
  上げる場合は overlay で増やす)
- 環境変数は overlay の ConfigMap から `envFrom` で注入
- `replicas: 1` を既定とする(実行キューがメモリ内のため水平スケールは
  シナリオ実行の分散にならない。スケール戦略は将来課題)

適用コマンド: `oc apply -k deploy/overlays/<system>`

## 5. 共通部分の管理(テンプレート + upstream merge)

### パス所有権

| 所有 | パス |
|---|---|
| テンプレート(共通) | `src/core/`, `Dockerfile`, `.dockerignore`, `deploy/base/`, `scripts/`, `package.json`, `tsconfig.json`, `playwright.config.ts`, `vitest.config.ts`, `docs/` |
| システム(fork 側) | `src/pages/`, `src/scenarios/`, `tests/`, `deploy/overlays/<system>/` |
| 共有(参照のみ、削除しない) | `fixtures/demo-app/`, サンプルの pages/scenarios/spec |

ルール:

- fork 側はテンプレート所有パスを**修正しない**。修正が必要ならテンプレートに
  PR を出し、merge で受け取る
- `package.json` はテンプレート所有だが、fork 固有の依存追加は許容する
  (衝突時は fork 側で手動解決。頻度は低い想定)

### fork 側の運用

```bash
# 初回(fork 直後)
git remote add upstream <社内Gitのテンプレートrepo URL>

# 共通修正の取り込み(開発時)
scripts/sync-upstream.sh            # = fetch + merge upstream/main
# リリース時は再現性のためタグを merge
scripts/sync-upstream.sh template-v1.3.0
```

- `scripts/sync-upstream.sh`: upstream 未登録なら案内を表示。引数なしは
  `upstream/main`、引数ありはそのタグ/ブランチを merge。衝突時は所有権表への
  リンクを表示して手動解決を促す
- テンプレートは意味のある単位で `template-vX.Y.Z` タグを打つ

### README の方針変更

現 README の「`fixtures/demo-app/` は削除する」という指示を**「残す」に変更**する。
fork 側で削除するとテンプレート側の変更時に modify/delete 衝突が発生するため。
サンプルシナリオの登録解除は fork 所有の `src/scenarios/index.ts` の編集で行う
(衝突しない)。

## 6. 開発フェーズ

| Phase | 内容 | 完了条件 |
|---|---|---|
| 1. CDN 排除 | Swagger UI 自前配信(`validatorUrl: null`)、`BROWSER_LAUNCH_ARGS` 追加、E2E 探索の env 駆動化(`BASE_URL`)+ デモ spec 分離 | 既存テスト green + 新規テスト(/ui HTML の外部 URL・validator 不在、**/ui 実描画で外部要求ゼロ(必須)**、launch args 伝播、`BASE_URL` 指定でデモを起動せず対象のみ実行) |
| 2. Docker | `scripts/package-deps.sh`、Dockerfile、`.dockerignore`、`docs/offline-build.md` | ローカルで docker build 成功、コンテナ起動して `/health` と demo シナリオ実行が成功 |
| 3. OpenShift | `deploy/base`(Route 無し)+ `deploy/overlays/example`(Route は opt-in)、`docs/deploy-openshift.md` | `kustomize build` が妥当な YAML を出力。base に Route が含まれず、overlay で opt-in・保護前提が明記(実クラスタ検証は持ち込み後) |
| 4. テンプレート運用 | `scripts/sync-upstream.sh`、README 更新(所有権表・fork 手順・削除方針変更) | スクリプトの動作確認(ローカルの bare repo を upstream に見立てたテスト) |

## 意図的にやらないこと(YAGNI)

- npm prune / イメージサイズ最適化(確実性優先。将来の改善項目)
- readOnlyRootFilesystem(ブラウザの書き込み先調査が必要。安定後の強化項目)
- 水平スケール対応(キューがメモリ内。必要になったら設計し直す)
- CI/CD パイプライン定義(環境依存が強い。手順書のみ提供)
- firefox / webkit のコンテナ検証(既定は chromium。イメージには同梱されるので
  必要時に BROWSER 環境変数で切替可能だが、動作保証は chromium のみ)
