# AI-Workflow Operational Policy (Blended) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テンプレートリポジトリ `playwright-api` に、superpowers 流(spec/plan)と GitHub/Codex ゲートを統合した「折衷版」運用方針の文書・指示ファイル一式を作成する。

**Architecture:** 成果物はすべて **ドキュメント**(コード変更なし)。共通基準 `docs/engineering-standards.md` を単一情報源とし、`CLAUDE.md`(Claude 向け)と `AGENTS.md`(Codex 向け)がそれを参照する。運用フロー全体は `docs/operations/ai-workflow-policy.md` に集約。GitHub 用の PR テンプレートと README 追記を加える。fork は upstream 所有ファイルを触らず `FORK.md` で opt-out する(default-on)。

**Tech Stack:** Markdown ドキュメントのみ。検証は `grep` によるセクション/相互参照チェックと、既存テスト(`npm test`, `npm run build`)がドキュメント追加で壊れないことの確認。

**設計スペック:** `docs/superpowers/specs/2026-07-26-ai-workflow-policy-design.md`(Codex 設計レビュー収束済み、`a2fba38`)。各タスクの内容はこのスペックの該当節に対応する。

**作業ブランチ:** 既存の `docs/ai-workflow-policy`(Draft PR #1)。本成果物は同ブランチ・同 PR に追加し、実装完了後に PR で最終 Codex レビュー → ユーザー受け入れ → マージする。

## Global Constraints

- **言語**: すべて日本語(既存 `README.md`・docs に合わせる)。
- **単一情報源**: 具体的な互換規則(例: Playwright の npm バージョンとイメージタグの完全一致)は
  `docs/engineering-standards.md` **のみ**に置く。`CLAUDE.md`/`AGENTS.md` は再掲せず参照する。
- **FORK.md 分岐**: `CLAUDE.md` と `AGENTS.md` は**冒頭**に必ず次を書く —
  「リポジトリ直下に `FORK.md` が存在する場合、本ファイルのテンプレート運用指示は適用せず
  `FORK.md` に従う」。
- **fork 配慮**: fork は upstream 所有ファイル(`CLAUDE.md`/`AGENTS.md`/`docs/engineering-standards.md`/
  `docs/operations/ai-workflow-policy.md`/`.github/pull_request_template.md`)を**削除・編集しない**。
  opt-out は `FORK.md` 追加のみ。適用状態は **default-on だが強制せず解除可能**。
- **整合ゲート**: 手動は簡潔なチェックリスト(承認・受け入れ・マージは最後にレビューした内容に対して
  行う / 変更後は再レビュー / 受け入れ後の変更は受け入れも取り直す / マージ前に
  `git fetch origin && git merge origin/<base>` で base 最新取り込み)。厳密・原子的保証は
  **CI(推奨する次ステップ)** に委譲。
- **サブエージェント**: 変更を伴う作業は主エージェント込みで同時 writer 1。read-only 調査のみ並列可。
- **既存の検証コマンド**: `npm test`(vitest run)、`npm run build`(tsc)、`npm run test:e2e`(playwright)。
- **コミット**: 各タスク末尾で1コミット。メッセージ末尾に Co-Authored-By 行を付す
  (このリポジトリの既存コミット慣行に合わせる)。

---

### Task 1: 共通基準 `docs/engineering-standards.md`

スペック §6.3。`CLAUDE.md`/`AGENTS.md` から参照される単一情報源。他タスクが参照するため最初に作る。

**Files:**
- Create: `docs/engineering-standards.md`

**Interfaces:**
- Produces: 見出しアンカー `## 言語とランタイム` / `## 固定バージョン方針` / `## コード規約` /
  `## 検証コマンド` / `## オフライン・コンテナ運用の制約`。`CLAUDE.md`・`AGENTS.md`・
  `ai-workflow-policy.md` はこのファイルへの相対リンクで参照する。

- [ ] **Step 1: ファイルを作成し、以下の内容を書く**

````markdown
# エンジニアリング共通基準

このファイルは `CLAUDE.md`(Claude Code 向け)と `AGENTS.md`(Codex 向け)の**共通参照先**です。
同じ規則を複数ファイルに重複記載せず、具体的な基準はここに一元化します。

## 言語とランタイム

- 言語: TypeScript(ESM、`"type": "module"`)。
- ランタイム: Node.js 24 系。HTTP は Hono(`@hono/node-server`)、OpenAPI は `@hono/zod-openapi`。
- ブラウザ自動化: Playwright(`playwright` / `@playwright/test`)。

## 固定バージョン方針

- **Playwright の npm バージョンと Docker イメージタグは完全一致**させる。`package.json` は
  キャレット(`^`)を付けず固定する(詳細と背景は
  `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` を参照)。
- 依存の更新は Issue → Draft PR → レビューの通常フローに従う(機械的更新でも CI と
  マージ判断は省略しない)。

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
````

- [ ] **Step 2: セクションの存在を検証**

Run: `grep -E '^## (言語とランタイム|固定バージョン方針|コード規約|検証コマンド|オフライン・コンテナ運用の制約)$' docs/engineering-standards.md | wc -l`
Expected: `5`

- [ ] **Step 3: コミット**

```bash
git add docs/engineering-standards.md
git commit -m "$(printf 'docs: add engineering-standards as the single source of shared rules\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: 運用方針本体 `docs/operations/ai-workflow-policy.md`

スペック §4・§5・§7・§8・§9・§10 + 方針書 §8/§9 のテンプレを、本プロジェクト用に集約した中心文書。
アップロード文書「AI支援開発プロジェクト運用方針書」を土台に、下記の**プロジェクト固有の差分**を反映する。

**Files:**
- Create: `docs/operations/ai-workflow-policy.md`

**Interfaces:**
- Consumes: `docs/engineering-standards.md`(Task 1)への参照。
- Produces: 見出しアンカー `## 役割` / `## ドキュメント対応` / `## ワークフロー` /
  `## 整合の確認` / `## 自動ゲートと CI(次ステップ)` / `## サブエージェント方針` /
  `## fork の扱い` / `## Codex レビュー依頼テンプレ`。`CLAUDE.md`/`AGENTS.md`/`README.md` から参照される。

- [ ] **Step 1: ファイルを作成する。以下の必須セクションと固有記述を必ず含める**

必須セクションと内容(スペックの該当節から**逐語で**移す。要約しすぎない):

1. `## 役割`(スペック §4 の表): ユーザー(sumikof)が Issue/設計承認/受け入れ/マージを兼務、
   Claude Code = 設計・実装、Codex = `@codex review` の独立レビュー、CI = 当面なし。
   「人間 Approve の必須化は行わず、PR コメントによる設計承認・受け入れを人間ゲートとする」を明記。
2. `## ドキュメント対応`(スペック §5 の表): 設計書=spec(`docs/superpowers/specs/…`)、
   実装計画=plan(`docs/superpowers/plans/…`)、ADR は当面 spec 集約、共通基準=
   `docs/engineering-standards.md`(相対リンク)。
3. `## ワークフロー`(スペック §7 の 1〜15 を**逐語で**移す)。加えて「設計レビューへ戻す条件」節も移す。
4. `## 整合の確認`(スペック §7「整合の確認」を逐語で移す): 簡易・手動チェックリスト3項
   (最後にレビューした内容に対して承認/受け入れ/マージ・受け入れ後の変更は受け入れも取り直す・
   マージ前に `git fetch origin && git merge origin/<base>`)+「厳密保証は CI」引用ブロック。
5. `## 自動ゲートと CI(次ステップ)`(スペック §8 を逐語で移す): 当面 CI 無し、CI を推奨する
   次ステップとする、CI で移管する保証と**その限界**(base/テスト整合までが原子的、
   レビュー/受け入れの SHA 束縛は専用 status check が必要)。
6. `## サブエージェント方針`(スペック §9 を逐語で移す)。
7. `## fork の扱い`(スペック §10 を逐語で移す): default-on + `FORK.md` opt-out、upstream 所有
   ファイルは削除・編集しない、補足(冒頭注記だけでは root 自動読込を止められない)。
8. `## Codex レビュー依頼テンプレ`(方針書 §9.1/§9.2 を移す): 設計レビュー用・最終レビュー用の
   依頼文テンプレ2種(`@codex review` から始まる本文)。
9. 先頭に **FORK.md 分岐の注記**(このファイルはテンプレート開発用。fork は `FORK.md` で opt-out 可)。

プロジェクト固有の差分(アップロード文書からの変更点。明示的にこう変える):
- 「設計書/実装計画」を superpowers の spec/plan に読み替える(§5 の対応表)。
- Issue 参照の push は SSH 不可のため **HTTPS/gh 経由**。
- Draft PR 作成前に **bootstrap コミット(空コミット可)** を置く。
- 独立レビュー担当は Codex(GitHub `@codex review`)。
- 人間 Approve 必須化・CI・ブランチ保護は当面見送り(CI は次ステップ推奨)。
- 整合は簡易・手動チェックリスト、厳密保証は CI に委譲。

- [ ] **Step 2: 必須セクションの存在を検証**

Run: `grep -E '^## (役割|ドキュメント対応|ワークフロー|整合の確認|自動ゲートと CI|サブエージェント方針|fork の扱い|Codex レビュー依頼テンプレ)' docs/operations/ai-workflow-policy.md | wc -l`
Expected: `8`

- [ ] **Step 3: 重複記載チェック(Playwright 具体規則が本文に無いこと)**

Run: `grep -c 'イメージタグ' docs/operations/ai-workflow-policy.md || true`
Expected: `0`(具体規則は engineering-standards のみ。運用方針では触れない)

- [ ] **Step 4: Codex 依頼テンプレの存在を検証**

Run: `grep -c '@codex review' docs/operations/ai-workflow-policy.md`
Expected: `2` 以上(設計・最終の2テンプレ)

- [ ] **Step 5: コミット**

```bash
git add docs/operations/ai-workflow-policy.md
git commit -m "$(printf 'docs: add project blended AI-workflow operational policy\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: `CLAUDE.md`(Claude Code 向け)

スペック §6.1。**冒頭に FORK.md 分岐**、共通基準参照、superpowers スキルの使い方。

**Files:**
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: `docs/operations/ai-workflow-policy.md`(Task 2)、`docs/engineering-standards.md`(Task 1)。

- [ ] **Step 1: ファイルを作成し、以下の内容を書く**

````markdown
# CLAUDE.md — Claude Code 向け運用指示

> **FORK.md 分岐**: リポジトリ直下に `FORK.md` が存在する場合、本ファイルのテンプレート運用指示
> (Issue → Draft PR → Codex → …)は適用せず、`FORK.md` の指示に従うこと。

このリポジトリはテンプレートです。開発時は次の運用に従います(全体像は
`docs/operations/ai-workflow-policy.md`、共通基準は `docs/engineering-standards.md`)。

- Issue と既存ドキュメント(spec / plan)を確認してから作業する。
- 設計開始時に Draft PR を先行作成する(push は HTTPS/gh 経由。差分ゼロでは PR を作れないため
  bootstrap コミットを先に置く)。
- **設計承認前に製品コードを実装しない**。
- Codex の指摘は無条件採用せず、コード・仕様・再現条件から妥当性を検証してから対応する。
- 既存の無関係な変更を上書き・削除・巻き戻さない。
- 設計変更時は spec を更新する。重大な設計変更は実装を止めて設計レビューへ戻す。
- Codex 最終レビュー後の変更は再レビュー対象であることを報告する。
- ユーザー確認前に PR をマージしない。
- **サブエージェント**: 変更を伴う作業は主エージェント込みで同時 1。read-only 調査のみ並列可。
- **superpowers スキル**: 設計は brainstorming、計画は writing-plans、実装は executing-plans /
  subagent-driven-development を用いる。
- 具体的な技術基準・検証コマンドは `docs/engineering-standards.md` を参照する。
````

- [ ] **Step 2: FORK.md 分岐が冒頭にあることを検証**

Run: `head -5 CLAUDE.md | grep -c 'FORK.md'`
Expected: `1` 以上

- [ ] **Step 3: 共通基準参照があり、具体規則の再掲が無いことを検証**

Run: `grep -c 'docs/engineering-standards.md' CLAUDE.md && (grep -c 'イメージタグ' CLAUDE.md || true)`
Expected: 1行目 `1` 以上、2行目 `0`

- [ ] **Step 4: コミット**

```bash
git add CLAUDE.md
git commit -m "$(printf 'docs: add CLAUDE.md with FORK.md opt-out preamble\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: `AGENTS.md`(Codex 向け)

スペック §6.2。**冒頭に FORK.md 分岐**、レビュー観点、**互換規則は再掲せず共通基準の適合確認責任のみ**。

**Files:**
- Create: `AGENTS.md`

**Interfaces:**
- Consumes: `docs/operations/ai-workflow-policy.md`(Task 2)、`docs/engineering-standards.md`(Task 1)。

- [ ] **Step 1: ファイルを作成し、以下の内容を書く**

````markdown
# AGENTS.md — Codex 向けレビュー指示

> **FORK.md 分岐**: リポジトリ直下に `FORK.md` が存在する場合、本ファイルのテンプレート運用指示は
> 適用せず、`FORK.md` の指示に従うこと。

Codex はこのリポジトリの独立レビュー担当です(全体像は `docs/operations/ai-workflow-policy.md`)。

- Issue、spec、実装コード、テストを相互に照合する。
- 設計フェーズと実装フェーズでレビュー観点を切り替える(設計フェーズはコード実装を要求しない)。
- 重大なバグ・回帰・セキュリティ問題を優先し、各指摘に**対象箇所・発生条件・影響・根拠・
  最小修正案**を示す。重大な手戻り・障害・脆弱性・仕様不一致につながるものは P1 とする。
- 好みや根拠のないスタイル指摘を避ける。情報不足時は推測で断定せず不足情報を示す。
- **プロジェクト固有の互換要件は再掲しない**。`docs/engineering-standards.md` の固定バージョン方針への
  **適合を確認する責任のみ**を負う(具体規則は共通基準側にのみ存在する)。
- 人間による承認・受け入れの代替にはならない(独立した品質ゲート)。
````

- [ ] **Step 2: FORK.md 分岐が冒頭にあり、互換規則が再掲されていないことを検証**

Run: `head -5 AGENTS.md | grep -c 'FORK.md' && (grep -c 'イメージタグ' AGENTS.md || true) && grep -c 'engineering-standards.md' AGENTS.md`
Expected: `1` 以上 / `0` / `1` 以上

- [ ] **Step 3: コミット**

```bash
git add AGENTS.md
git commit -m "$(printf 'docs: add AGENTS.md for Codex with compat-check-only responsibility\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: `.github/pull_request_template.md`

方針書 §8 の PR 本文構成(フェーズチェックリスト・検証結果表・レビュー履歴表)。

**Files:**
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: ファイルを作成し、以下の内容を書く**

````markdown
## 関連Issue

Relates to #<Issue番号>

## 現在のフェーズ

- [ ] 設計書(spec)作成
- [ ] Codex設計レビュー
- [ ] 設計指摘対応
- [ ] ユーザー設計承認
- [ ] 実装計画(plan)+ plan 整合性チェック
- [ ] 実装
- [ ] ローカル検証
- [ ] Codex最終レビュー
- [ ] 最終指摘対応
- [ ] ユーザー受け入れ確認
- [ ] マージ準備

## 目的

<この変更の目的>

## 変更内容

- <変更点>

## 設計ドキュメント

- `docs/superpowers/specs/<spec>.md`

## 受け入れ条件

- [ ] <条件>

## 検証結果

| 検証 | コマンド | 結果 |
| --- | --- | --- |
| 単体テスト | `npm test` | 未実施 |
| ビルド | `npm run build` | 未実施 |
| E2E | `npm run test:e2e` | 未実施 |

## レビュー履歴

| フェーズ | 対象コミット | 結果 |
| --- | --- | --- |
| 設計レビュー | `<SHA>` | 未実施 |
| 最終レビュー | `<SHA>` | 未実施 |

## 既知の制限

- なし

## 未決事項

- なし
````

- [ ] **Step 2: フェーズチェックリストと検証結果表の存在を検証**

Run: `grep -c '現在のフェーズ' .github/pull_request_template.md && grep -c 'npm test' .github/pull_request_template.md`
Expected: 各 `1` 以上

- [ ] **Step 3: コミット**

```bash
git add .github/pull_request_template.md
git commit -m "$(printf 'docs: add PR template (phase checklist, verification, review history)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `README.md` 追記(運用フロー概要 + fork opt-out)

スペック §12。既存 README の末尾付近に運用フロー概要と fork の opt-out 手順を追記する。

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `docs/operations/ai-workflow-policy.md`(Task 2)への参照。

- [ ] **Step 1: `README.md` の末尾に次のセクションを追記する**

````markdown
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
````

- [ ] **Step 2: 追記内容の存在を検証**

Run: `grep -c '開発運用' README.md && grep -c 'FORK.md' README.md`
Expected: 各 `1` 以上

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "$(printf 'docs: document dev workflow and fork FORK.md opt-out in README\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: 全体整合の検証とローカル検証(最終レビュー前ゲート)

スペック §7 手順11 のローカル検証と、成果物間の相互参照が壊れていないことの確認。

**Files:**
- (検証のみ。必要なら軽微な相互リンク修正)

- [ ] **Step 1: 相互参照リンクの実在を検証**

Run:
```bash
for f in docs/engineering-standards.md docs/operations/ai-workflow-policy.md CLAUDE.md AGENTS.md README.md .github/pull_request_template.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
grep -rl 'docs/engineering-standards.md' CLAUDE.md AGENTS.md docs/operations/ai-workflow-policy.md
```
Expected: 6ファイルすべて `OK`。参照元3ファイルが列挙される。

- [ ] **Step 2: FORK.md 分岐が CLAUDE.md と AGENTS.md の双方の冒頭にあることを検証**

Run: `for f in CLAUDE.md AGENTS.md; do head -5 "$f" | grep -q 'FORK.md' && echo "OK $f" || echo "NG $f"; done`
Expected: 両方 `OK`

- [ ] **Step 3: 既存テストとビルドがドキュメント追加で壊れていないことを確認**

Run: `npm test && npm run build`
Expected: いずれも成功(ドキュメントのみの変更のため既存挙動は不変)。

- [ ] **Step 4: base の最新を取り込む(最終レビュー前)**

Run: `git fetch origin && git merge origin/main`
Expected: コンフリクトなし(単一 PR 運用のため通常は fast-forward)。

- [ ] **Step 5: PR にローカル検証結果を記録し、Draft を解除する準備を報告**

実行したコマンドと結果を PR #1 の「検証結果」表へ記入する(手動)。以降は運用フロー §7 手順12
(`@codex review` 最終レビュー)→ 手順13〜15(指摘対応 → ユーザー受け入れ → マージ)へ接続する。

- [ ] **Step 6: コミット(検証で相互リンク等を修正した場合のみ)**

```bash
git add -A
git commit -m "$(printf 'docs: fix cross-references after policy files verification\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## 実装後の接続(この plan の外)

- 本 plan 完了後、PR #1 で **Codex 最終レビュー → ユーザー受け入れ → マージ**(運用フロー §7 手順12〜15)。
- マージ後、本来の次作業 **offline/Docker/OpenShift 対応**(spec `2026-07-24-…` 作成済み)を、
  この確定フロー(Issue → Draft PR → Codex 設計レビュー → 承認 → writing-plans → 実装)で進める。
