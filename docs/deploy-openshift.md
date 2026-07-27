# OpenShift へのデプロイ

このガイドでは、`playwright-api` を OpenShift クラスタにデプロイするための手順を説明します。

## 前提条件

### 環境要件

- **OpenShift クラスタ**: rootless Pod に対応し、`restricted-v2` Security Context Constraint (SCC) が有効になっている環境を想定しています。
- **イメージレジストリ**: コンテナイメージが既に内部レジストリに push されていることが前提です。イメージのビルド・push 方法については [`docs/offline-build.md`](./offline-build.md) を参照してください。

### セキュリティコンテキスト

マニフェスト（`deploy/base/deployment.yaml`）では以下のセキュリティ設定を適用しています：

- `runAsNonRoot: true` - root 権限での実行を禁止
- `seccompProfile.type: RuntimeDefault` - 標準の seccomp プロファイルを使用
- `allowPrivilegeEscalation: false` - 特権昇格を禁止
- `capabilities.drop: [ALL]` - すべての Linux Capability を削除
- `restricted-v2` SCC の動的 UID 割り当てに対応（マニフェストでは `runAsUser` を明記しません）

## Overlay の用意

### ステップ 1: Example Overlay をコピー

デプロイするシステムのカスタマイズされた overlay を作成するため、example overlay をコピーします：

```bash
# 例: "my-system" という名前の overlay を作成する場合
cp -r deploy/overlays/example deploy/overlays/my-system
```

以降、コマンドの `<system>` を実際のシステム名に置き換えて実行してください。

### ステップ 2: イメージタグの設定

`deploy/overlays/<system>/kustomization.yaml` を編集し、コンテナイメージの内部レジストリ名とタグを設定します：

```yaml
images:
  - name: playwright-api
    newName: registry.internal/playwright-api  # 内部レジストリの URL に変更
    newTag: "1.0.0"                             # 適切なイメージタグを指定
```

### ステップ 3: ConfigMap の編集

`deploy/overlays/<system>/configmap.yaml` を編集し、アプリケーションのランタイム設定を実環境に合わせます：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: playwright-api-config
  labels:
    app: playwright-api
data:
  BASE_URL: "https://target.example.internal"  # スクレイピング対象の基盤 URL
  MAX_CONCURRENCY: "1"                         # 同時実行数（リソース制限に応じて調整）
```

主な設定項目：

- `BASE_URL`: playwright-api が訪問するウェブサイトの基盤 URL（例: `https://example.com`）
- `MAX_CONCURRENCY`: 同時に実行可能なスクレイピング数。Pod のリソース制限（CPU/メモリ）とクラスタの負荷に応じて調整してください

## マニフェストの適用

### 検証ステップ（推奨）

マニフェストを適用する前に、必ず生成される YAML を確認してください：

```bash
# Kustomize で最終的な YAML を生成・確認
oc kustomize deploy/overlays/<system>

# または kubectl でも同じく可能
kubectl kustomize deploy/overlays/<system>
```

出力を確認し、イメージタグ、レジストリ名、環境変数が正しく設定されていることを確認してください。

### マニフェストの適用

確認後、以下のコマンドで OpenShift クラスタにデプロイします：

```bash
oc apply -k deploy/overlays/<system>
```

デプロイが完了したことを確認：

```bash
# Pod のステータスを確認
oc get pods -l app=playwright-api

# Pod のログを確認
oc logs -l app=playwright-api
```

## ルート（Route）の外部公開と必須保護

### ベースに Route は含まれない

`deploy/base/` には Route が含まれていません。Route を公開するかどうかは、各 overlay での判断に委ねられています。

さらに、`deploy/overlays/example/` の `kustomization.yaml` は **既定では `route.yaml` を `resources` に含めていません**。`oc apply -k` を実行しても Route は作成されず、公開されない状態が既定です。Route を有効化する場合は、下記「Route を公開する場合の必須保護」に従って TLS・認証プロキシ・到達元制限を先に構成してから、`kustomization.yaml` の `resources` に `route.yaml` を追加し、`oc apply -k` を再実行してください。

### 公開しない運用も選択可能

この API は**無認証**です。外部に公開する場合には強力なセキュリティ対策が必須です。公開しない運用（以下のいずれか）も有効な選択肢です：

- **ClusterIP サービスのみ**: Pod は ClusterIP Service で内部通信のみに限定
- **ポートフォワード経由**: `oc port-forward svc/playwright-api 3000:3000` でローカルマシンからのアクセスのみ許可
- **VPN/プライベートネットワーク**: クラスタと同じプライベートネットワーク内のみからアクセス

### Route を公開する場合の必須保護

Route（`deploy/overlays/<system>/route.yaml`）を有効化して外部に公開する場合、以下の保護が必須です：

#### 1. **TLS 暗号化（既に設定済み）**

example overlay の Route マニフェストには以下の設定が含まれています：

```yaml
tls:
  termination: edge
  insecureEdgeTerminationPolicy: Redirect
```

これにより、TLS が自動的に終端され、HTTP アクセスは HTTPS にリダイレクトされます。

#### 2. **認証・認可プロキシ（必須追加）**

この API 自体には認証機能がありません。以下のいずれかの認証層を Route の前に導入してください：

- **OpenShift ビルトイン認証**: OAuth2 プロキシを使用して OpenID Connect (OIDC) 認証を統合
- **外部認証サービス**: Keycloak、Okta、Azure AD などのシングルサインオン (SSO) サービスと連携
- **API ゲートウェイ**: Kong、Apigee などのゲートウェイで API キー認証や JWT 検証を実装

#### 3. **到達元 IP 制限（推奨）**

NetworkPolicy を使用して、許可された IP または Pod からのアクセスのみを許可します：

```bash
# 例: 特定の namespace からのアクセスのみを許可する NetworkPolicy
oc create -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: playwright-api-allow
spec:
  podSelector:
    matchLabels:
      app: playwright-api
  policyTypes:
    - Ingress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: authorized-namespace
      ports:
        - protocol: TCP
          port: 3000
EOF
```

### ⚠️ セキュリティ警告

**このAPI は無認証で動作します。** リクエストパラメータ（パスワードを含む）は、Pod の `/app/runs` ディレクトリに `result.json` として平文で保存されます。無防備な外部公開は厳禁です。

## ランタイム設定の要点

### 動的 UID の割り当て

マニフェストでは `runAsUser` を明記していません。OpenShift の `restricted-v2` SCC は Pod に対して動的にユーザー ID を割り当てます。これにより、各 Pod が一意の非 root UID で実行され、セキュリティが向上します。

### 一時的なボリューム（emptyDir）

以下の 2 つのボリュームは `emptyDir` として設定されており、Pod の再起動時にデータは消去されます：

```yaml
volumes:
  - name: runs
    emptyDir: {}      # スクレイピング結果の一時保存先
  - name: tmp
    emptyDir: {}      # 一時ファイルディレクトリ
```

- `/app/runs`: スクレイピング実行結果のログや `result.json` が保存される
- `/tmp`: ブラウザプロセスや Node.js の一時ファイル格納先

Pod が再起動されると、これらのボリュームはリセットされます。永続的なデータが必要な場合は、PersistentVolumeClaim (PVC) を使用するようにマニフェストを修正してください。

### ヘルスチェック

Deployment で以下のプローブが設定されています：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
readinessProbe:
  httpGet:
    path: /health
    port: 3000
```

両プローブは `/health` エンドポイントを監視しており、Pod が応答しない場合は自動的に再起動・除外されます。

### ブラウザのサンドボックス設定

Dockerfile では以下の環境変数が設定されています：

```dockerfile
ENV BROWSER_LAUNCH_ARGS="--no-sandbox"
```

OpenShift のセキュリティ制限下（特に `restricted-v2` SCC）では、Chromium ブラウザの sandbox 機能が制約を受けるため、`--no-sandbox` フラグが必須です。このフラグは既に Dockerfile に組み込まれており、追加の設定は不要です。

## リソース設定

マニフェストでは以下のリソース設定が指定されています：

```yaml
resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    memory: 2Gi
```

これらの値は、単一のスクレイピングタスクを想定した初期設定です。実環境のワークロードに応じて、以下を考慮して調整してください：

- **CPU requests/limits**: スクレイピングの並行度が高い場合は増加
- **メモリ requests**: `MAX_CONCURRENCY` が大きい場合は増加（Chromium プロセスごとに 200〜500MB 必要）
- **メモリ limits**: OOM キルを避けるため、クラスタのメモリ容量とノード数に応じて設定

## トラブルシューティング

### Pod が Pending 状態のままの場合

```bash
# Pod のイベントを確認
oc describe pod -l app=playwright-api

# ノードのリソース状況を確認
oc top nodes
```

考えられる原因：
- ノードのリソース不足（CPU/メモリ）
- イメージのプル失敗（レジストリ接続エラー、認証エラー）
- セキュリティポリシーによるブロック

### Pod がクラッシュループする場合

```bash
# Pod のログを詳しく確認
oc logs -l app=playwright-api --tail=100 -f

# 前のインスタンスのログも確認
oc logs -l app=playwright-api --previous
```

### Route へのアクセスが拒否される場合

- TLS 証明書が正しく設定されているか確認：`oc get route playwright-api -o yaml`
- 認証プロキシの設定を確認
- NetworkPolicy による制限がないか確認：`oc get networkpolicies`

## まとめ

1. `deploy/overlays/example` をシステム名でコピーし、イメージタグと ConfigMap を編集
2. `kubectl kustomize deploy/overlays/<system>` で YAML を確認
3. `oc apply -k deploy/overlays/<system>` でデプロイ
4. Route を公開する場合は、**TLS + 認証プロキシ + IP 制限** の 3 層構成を必須で実装
5. `/app/runs` と `/tmp` は emptyDir であり、Pod 再起動で消去されることに注意
6. `restricted-v2` SCC による動的 UID 割り当てに任せる（`runAsUser` は不要）
