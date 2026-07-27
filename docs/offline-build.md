# オフラインビルド手順書

このドキュメントは、インターネット接続がない環境（Docker、OpenShift など）での `playwright-api` のビルドと実行手順を説明します。

---

## 1. バージョン整合の原則

**重要**: Playwright のビルドが正常に機能するには、以下の 3 つのバージョンが完全に一致している必要があります。

| 対象 | 現在の値 | 備考 |
|------|---------|------|
| `package.json` の `playwright` | `1.61.1` | キャレット（`^`）**なし**で固定 |
| `package.json` の `@playwright/test` | `1.61.1` | キャレット（`^`）**なし**で固定 |
| ベースイメージタグ | `mcr.microsoft.com/playwright:v1.61.1-noble` | `v<X.Y.Z>-noble` 形式 |

**バージョン不一致により以下の問題が発生します**:
- ネイティブバイナリの不整合
- ブラウザランタイムのクラッシュ
- テスト実行の失敗

すべてを同じバージョンに揃えてください。

---

## 2. 外部環境(ネット接続あり)での成果物作成

インターネット接続のある環境で、以下の依存成果物を準備します。

### 2.1 前提条件

- Docker がインストールされている
- Node.js 18 以上がインストールされている
- インターネット接続が利用可能
- `docker` コマンドが実行可能

### 2.2 実行手順

**ステップ 1**: リポジトリをクローン
```bash
git clone <repository-url>
cd playwright-api
```

**ステップ 2**: パッケージング スクリプトを実行
```bash
bash scripts/package-deps.sh
```

このスクリプトは以下の処理を行います:

1. `package.json` から Playwright バージョンを読み込む（例: `1.61.1`）
2. `npm ci` を実行して依存関係をインストール
3. `node_modules` を圧縮して `vendor/node_modules.tar.gz` を生成
4. Microsoft Playwright ベースイメージをプル: `mcr.microsoft.com/playwright:v1.61.1-noble`
5. イメージを保存して `vendor/playwright-base.tar` を生成

### 2.3 生成されるファイル

スクリプト実行後、以下の 2 つのファイルが `vendor/` ディレクトリに生成されます:

```
vendor/
├── node_modules.tar.gz      # 圧縮された依存関係（約 500MB～1GB）
└── playwright-base.tar       # ベースイメージのダンプ（約 2GB）
```

これらのファイルを社内 Git 経由でオフライン環境に転送してください。

---

## 3. オフライン側への持ち込み

インターネット接続のないオフライン環境での操作手順です。

### 3.1 必要なファイル

以下を持ち込む必要があります:
- `vendor/node_modules.tar.gz`
- `vendor/playwright-base.tar`
- リポジトリ全体（`Dockerfile`, `package.json`, `src/`, `tsconfig.json` など）

### 3.2 ベースイメージのロード

オフライン環境で以下を実行します:

```bash
docker load -i vendor/playwright-base.tar
```

このコマンドにより、ローカル Docker イメージストレージに `mcr.microsoft.com/playwright:v1.61.1-noble` がロードされます。

**確認**:
```bash
docker images | grep playwright
```

出力例:
```
mcr.microsoft.com/playwright   v1.61.1-noble   <IMAGE_ID>   2 hours ago   2.1GB
```

### 3.3 内部レジストリへの登録（オプション）

複数のマシンやノードで共有する場合、社内 Docker レジストリにプッシュします:

```bash
# タグ付け（例: internal-registry.example.com/playwright:v1.61.1-noble）
docker tag mcr.microsoft.com/playwright:v1.61.1-noble \
  internal-registry.example.com/playwright:v1.61.1-noble

# レジストリへプッシュ
docker push internal-registry.example.com/playwright:v1.61.1-noble
```

---

## 4. ビルド

オフライン環境でアプリケーションイメージをビルドします。

### 4.1 前提条件

- `vendor/node_modules.tar.gz` がリポジトリのルートディレクトリに配置されている
- ベースイメージが `docker load` されている

### 4.2 Microsoft 公式イメージを使用する場合

```bash
docker build -t playwright-api:1.61.1 .
```

`Dockerfile` に指定されたデフォルトの `BASE_IMAGE=mcr.microsoft.com/playwright:v1.61.1-noble` が使用されます。

### 4.3 内部レジストリのイメージを使用する場合

社内 Docker レジストリを使用する場合、`--build-arg` で `BASE_IMAGE` を指定します:

```bash
docker build \
  --build-arg BASE_IMAGE=internal-registry.example.com/playwright:v1.61.1-noble \
  -t playwright-api:1.61.1 .
```

### 4.4 ビルドプロセスの説明

`Dockerfile` は以下の処理を実行します:

1. **ステージ 1（build）**: 
   - ベースイメージから開始
   - `vendor/node_modules.tar.gz` を展開
   - TypeScript ソースコードをコンパイル（`npx tsc`）
   - 生成された `dist/` ディレクトリを作成

2. **ステージ 2（runtime）**:
   - クリーンなベースイメージから開始
   - ビルドステージから `node_modules` と `dist` をコピー
   - 環境変数を設定（`NODE_ENV=production` など）
   - ポート 3000 をエクスポーズ
   - アプリケーションを起動

### 4.5 ビルド結果の確認

```bash
docker build -t playwright-api:1.61.1 . && \
  docker run --rm playwright-api:1.61.1 node -v
```

正常にビルドされた場合、Node.js のバージョンが出力されます。

---

## 5. 更新時のバージョン対応

Playwright を新しいバージョンにアップグレードする場合、以下の手順で一括更新します。

### 5.1 バージョン更新ステップ

新しいバージョン（例: `1.62.0`）へ更新する場合:

**ステップ 1**: `package.json` を更新
```json
{
  "dependencies": {
    "playwright": "1.62.0"      // 更新
  },
  "devDependencies": {
    "@playwright/test": "1.62.0"  // 更新
  }
}
```

**ステップ 2**: インターネット接続のある環境で再度パッケージング
```bash
bash scripts/package-deps.sh
```

このコマンドが自動的に以下を行います:
- 新しい `package.json` バージョンを読み込む
- `npm ci` で新しい依存関係をインストール
- `vendor/node_modules.tar.gz` を再生成
- `mcr.microsoft.com/playwright:v1.62.0-noble` をプル
- `vendor/playwright-base.tar` を再生成

**ステップ 3**: 新しい成果物をオフライン環境に転送
- 更新された `vendor/node_modules.tar.gz`
- 更新された `vendor/playwright-base.tar`
- 更新された `package.json`

**ステップ 4**: オフライン環境でビルド
```bash
docker load -i vendor/playwright-base.tar
docker build -t playwright-api:1.62.0 .
```

### 5.2 バージョン一覧

以下は既知の Playwright バージョンとベースイメージの対応です:

| Playwright バージョン | ベースイメージ | 備考 |
|----------------------|--------------|------|
| 1.61.1 | `mcr.microsoft.com/playwright:v1.61.1-noble` | 現在の安定版 |
| 1.62.0 | `mcr.microsoft.com/playwright:v1.62.0-noble` | テスト中 |
| 1.60.0 | `mcr.microsoft.com/playwright:v1.60.0-noble` | 非推奨 |

### 5.3 チェックリスト

バージョン更新時に以下を確認してください:

- [ ] `package.json` の `playwright` バージョンを更新
- [ ] `package.json` の `@playwright/test` バージョンを更新
- [ ] `Dockerfile` の `BASE_IMAGE` を新しいバージョンに更新（またはビルド時に `--build-arg` で指定）
- [ ] インターネット環境で `bash scripts/package-deps.sh` を実行
- [ ] 新しい `vendor/node_modules.tar.gz` と `vendor/playwright-base.tar` を確認
- [ ] オフライン環境で `docker load` テストを実行
- [ ] オフライン環境でビルドテストを実行

---

## トラブルシューティング

### イメージロードに失敗する
```bash
docker load -i vendor/playwright-base.tar
# エラー: "failed to solve with frontend dockerfile.v0"
```

**原因**: `playwright-base.tar` が破損しているか、ディスク容量が不足している可能性があります。

**対策**:
```bash
# ディスク容量を確認
df -h

# ファイルのハッシュを確認（外部環境で生成時のハッシュと比較）
sha256sum vendor/playwright-base.tar
```

### ビルドに失敗する
```
ERROR: failed to solve: executor failed
```

**原因**: `node_modules.tar.gz` が展開されていない、またはベースイメージが見つからないことが考えられます。

**対策**:
```bash
# ベースイメージが存在するか確認
docker images | grep playwright

# vendor ディレクトリを確認
ls -lh vendor/

# Dockerfile が正しいか確認
cat Dockerfile
```

### Playwright が実行時にクラッシュする
```
Error: Chromium path is not found
```

**原因**: バージョン不一致の可能性が高いです。

**対策**:
1. `package.json` のバージョンを確認
2. ベースイメージのタグが一致しているか確認
3. `node_modules.tar.gz` が最新か確認

---

## セキュリティに関する注意

- `vendor/playwright-base.tar` は約 2GB の大きなファイルです。転送時は暗号化を使用してください（例: HTTPS、SSH）
- オフライン環境内のレジストリは認証で保護してください
- `docker load` の実行後、イメージの出所を確認してください

---

## 参考資料

- `scripts/package-deps.sh` - パッケージング自動スクリプト
- `Dockerfile` - ビルド定義
- `package.json` - 依存関係定義
- [Playwright Docker Image Documentation](https://playwright.dev/)
