# 設計スペック — テンプレート開発 運用方針(superpowers × 方針書 折衷版)

最終更新: 2026-07-26

## 1. 背景と目的

このリポジトリ `playwright-api`(Playwright E2E API サーバのテンプレート)の開発運用を、
アップロードされた「AI支援開発プロジェクト運用方針書」(Issue → Draft PR → Codex 独立レビュー
→ 人間承認 → マージ の GitHub 中心フロー)と、現状の superpowers 流(spec → plan → 実装を
main へ直コミット)を**統合した折衷版**として定義しなおす。

目的:

- 設計承認前に実装しない、独立レビューを挟む、人間がマージ判断する、という方針書のガードを取り込む
- 一方で superpowers の spec/plan 資産と用語をそのまま活かし、二重管理を避ける
- ソロ開発・CI 未整備・Codex 導入済み(GitHub `@codex review`)という**このプロジェクトの実態**に合わせる

### この見直しに至った前提の変化

- `gh` CLI が利用可能になった(認証済み・scopes: `repo`, `workflow`)。SSH バイナリは無いが、
  HTTPS 経由で push / PR 作成が可能 → 方針書が前提とする Draft PR 運用が現実的になった
- Codex は GitHub PR コメントの `@codex review` で稼働可能(ユーザー設定済み)

## 2. 対象範囲と対象外

**対象**: このテンプレートリポジトリ `playwright-api` の**開発時**の運用ルールと、
それを支える指示ファイル・テンプレートの整備。

**対象外**:

- fork した各システム側の運用(強制しない。方針ファイルは fork にとって参考/上書き可)
- CI・ブランチ保護の実導入(当面見送り。将来 TODO として記載のみ)
- 独立 ADR 体系の導入(当面は spec 内に集約)

## 3. 確定した設計判断(ブレインストーミングでユーザー承認済み)

| 論点 | 決定 |
|---|---|
| 運用の骨格 | 両者を統合した**折衷版**。superpowers を土台に方針書のゲートを重ねる |
| 独立レビュー担当 | **Codex を正式採用**(GitHub PR の `@codex review`、設定済み)。`AGENTS.md` を新設 |
| 適用範囲 | **テンプレート開発のみ**。fork には強制せず参考扱い |
| 自動ゲート(CI/保護) | **当面導入しない**。人間ゲート + ローカル検証 + チェックリストで担保。将来 CI化を明記 |
| サブエージェント | 実装・ファイル変更を伴うものは**直列(最大1)厳守**。read-only の調査のみ軽い並列可 |

## 4. 役割のソロ運用への写像

| 方針書の役割 | このプロジェクトでの担い手 | 主な責任 |
|---|---|---|
| Issue作成者 / ユーザー / Maintainer | **ユーザー(sumikof)が兼務** | Issue 起票、設計承認、受け入れ確認、マージ |
| Claude Code | Claude Code | 調査・spec・plan・実装・テスト・PR 更新・指摘対応 |
| Codex | Codex(GitHub App) | 設計/最終の独立レビュー、Issue/spec/コード/テストの整合性確認 |
| CI | (当面なし) | ローカル `npm test` / `npx playwright test` を人間が確認 |

人間ゲートはユーザー1名が複数役割を兼務する。GitHub 上での「自分の PR を自分で Approve」は
できないため、**人間 Approve の必須化は行わず**、PR コメントによる設計承認・受け入れ確認を
人間ゲートとする。

## 5. ドキュメント対応(二重管理の回避)

方針書の用語を superpowers 資産へ写像する。

| 方針書の用語 | このプロジェクトでの実体 |
|---|---|
| 設計書(`docs/design/issue-N-*.md`) | **spec** = `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` |
| 実装計画 | **plan** = `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` |
| ADR(`docs/decisions/ADR-*.md`) | 当面は spec 内「設計方針 / 未決事項」に集約。独立 ADR は必要時のみ |
| 共通基準(`docs/engineering-standards.md`) | **新規作成**。言語/ランタイム/固定バージョン方針/コード規約/検証コマンドを集約 |

- 方針書「設計書の標準項目」は spec テンプレートに取り込む。重い項目(トランザクション境界、
  移行・ロールバック等)は該当する変更のときのみ記載する。
- `CLAUDE.md` と `AGENTS.md` は共通基準を重複記載せず `docs/engineering-standards.md` を参照する。

## 6. 新規作成する AI 向け指示ファイル

### 6.1 `CLAUDE.md`(Claude Code 向け)

- Issue と既存ドキュメントを確認してから作業する
- 設計開始時に Draft PR を先行作成する
- 設計承認前に製品コードを実装しない
- Codex の指摘は無条件採用せず、コード・仕様・再現条件から妥当性を検証する
- 既存の無関係な変更を上書き・削除・巻き戻さない
- 設計変更時は spec を更新する。重大変更は実装を止めて設計レビューへ戻す
- Codex 最終レビュー後の変更は再レビュー対象であることを報告する
- ユーザー確認前に PR をマージしない
- サブエージェントは**実装・変更を伴うものは直列(最大1)**。read-only 調査のみ軽い並列可
- superpowers スキルの使い方(brainstorming → writing-plans → executing/subagent-driven)を明記
- 共通基準は `docs/engineering-standards.md` を参照

### 6.2 `AGENTS.md`(Codex 向け)

- Issue、spec、実装コード、テストを相互に照合する
- 設計フェーズと実装フェーズでレビュー観点を切り替える
- 重大なバグ・回帰・セキュリティ問題を優先し、重大度・発生条件・影響・根拠・最小修正案を示す
- 好みや根拠のないスタイル指摘を避ける
- 情報不足時は推測で断定せず不足情報を示す
- プロジェクト固有の互換要件(Playwright の npm バージョンとイメージタグの完全一致等)を守る
- 共通基準は `docs/engineering-standards.md` を参照

### 6.3 `docs/engineering-standards.md`(共通基準)

- 言語 / ランタイム(TypeScript, Node, Hono 等)
- **固定バージョン方針**(Playwright はキャレットなしで固定、npm 版とイメージタグ一致)
- コード規約・命名・ディレクトリ構成の要点
- 検証コマンド(`npm test`, `npx playwright test`, build 等)
- オフライン/コンテナ運用上の制約(既存 spec を参照)

## 7. ワークフロー(折衷)

方針書の 15 工程を superpowers に合わせて具体化する。

1. ユーザーが Issue 作成(`gh` 利用可)。背景・目的・対象/対象外・要件・受け入れ条件・制約を明記
2. Claude が作業ブランチ + **Draft PR** を作成(`Relates to #<N>`)。push は **HTTPS/gh 経由**
3. 設計 = `superpowers:brainstorming` → spec 作成・コミット・PR 本文へ反映
4. PR に `@codex review`(設計レビュー用テンプレ)を投稿
5. Claude が各指摘の妥当性を検証 → spec 修正、対応しない指摘は根拠を PR に記録、対象 SHA を記録
6. ユーザーが PR で設計承認コメント(定型文)。承認前は実装しない
7. 承認後 = `superpowers:writing-plans` で plan 作成 →
   `superpowers:executing-plans` または `superpowers:subagent-driven-development` で実装 + テスト
8. ローカル検証(`npm test`, `npx playwright test` 等)の結果を PR に記録し、Draft 解除
9. `@codex review`(最終レビュー用テンプレ)→ 指摘対応・必要なら再レビュー、最終 SHA を記録
10. ユーザー受け入れ確認(方針書のチェックリスト形式)
11. ユーザーがマージ(直前に `Closes #<N>` へ変更)→ Issue close、残課題は別 Issue へ

### 設計レビューへ戻す条件(方針書 7.6 準拠)

公開 API/外部 IF 変更、データモデル変更、認証・認可方式変更、新規外部依存追加、
受け入れ条件変更、対象範囲拡大、性能・セキュリティ・運用への重大影響 —
これらが生じたら実装を止め、spec を更新して設計レビュー + ユーザー承認からやり直す。

## 8. 自動ゲートの現実解

- CI・ブランチ保護は**当面導入しない**。
- 当面のゲート = **ローカル検証コマンドの結果 + 方針書チェックリスト + 人間の承認・受け入れ・マージ**。
- 方針書に「将来 CI化」を TODO として明記:
  - GitHub Actions で `npm test` / build(可能なら Playwright テスト)を必須化
  - ブランチ保護: PR 経由必須 / CI グリーン必須 / 未解決会話なし / force push 禁止 / main 直接 push 禁止
  - 人間 Approve の必須化はソロ運用では見送り(体制変化時に再検討)

## 9. サブエージェント方針

- 実装・ファイル変更を伴う作業は**直列・最大1・並列禁止**を既定とする(方針書 5.1 準拠)。
- read-only の調査(`Explore` 等)に限り軽い並列を許容する。
- 並列を使う場合も、変更のマージや状態共有を伴わないことを条件とする。

## 10. 適用範囲と fork 配慮

- 方針ファイル(`CLAUDE.md` / `AGENTS.md` / `docs/engineering-standards.md` /
  `docs/operations/ai-workflow-policy.md` / 将来の CI)はテンプレート開発用。
- upstream merge で fork にも届くが、各ファイル冒頭と README に
  「**fork 側は自システムの運用に置換・削除してよい(参考扱い)**」と明記する。
- fork 側が削除しても upstream merge 衝突が起きにくいよう、既存の
  「demo-app は残す・登録解除は fork 所有ファイルで行う」方針(offline spec)と整合させる。

## 11. 直近の offline/Docker/OpenShift 作業への適用

- 既存 spec `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` は作成済み。
- 本ワークフローでは次から開始する:
  1. Issue 起票(offline/Docker/OpenShift 対応)
  2. Draft PR 作成(`Relates to #<N>`)
  3. 既存 spec を `@codex review`(設計レビュー)
  4. ユーザー設計承認
  5. `superpowers:writing-plans` で
     `docs/superpowers/plans/2026-07-24-offline-docker-openshift.md` を作成
  6. 実装(Phase 1〜4)
- 従来の「main へ直コミット」は Issue / Draft PR 起点へ切り替える。

## 12. この見直しで作る/更新する成果物

実装フェーズ(writing-plans → 実装)で作成・更新するファイル:

| ファイル | 内容 |
|---|---|
| `docs/operations/ai-workflow-policy.md` | プロジェクト版 運用方針書(アップロード文書を本プロジェクト用に改訂) |
| `CLAUDE.md` | Claude Code 向け指示(6.1) |
| `AGENTS.md` | Codex 向け指示(6.2) |
| `docs/engineering-standards.md` | 共通基準(6.3) |
| `.github/pull_request_template.md` | 方針書 §8 の PR 本文構成(フェーズチェックリスト・検証結果表・レビュー履歴表) |
| Codex 依頼テンプレ | 設計/最終レビュー依頼文(方針書 §9)。方針書ドキュメント内に収録 |
| `README.md` 追記 | 運用フロー概要、fork 側の扱い(参考/置換可)への言及 |

## 13. 受け入れ条件

- 折衷版ワークフローが `docs/operations/ai-workflow-policy.md` に明文化されている
- `CLAUDE.md` / `AGENTS.md` / `docs/engineering-standards.md` が作成され、共通基準を重複なく参照している
- PR テンプレートと Codex 依頼テンプレが利用可能
- 「テンプレート開発のみ適用 / fork は参考扱い」が各所に明記されている
- 直近の offline/Docker/OpenShift 作業が本ワークフロー(Issue → Draft PR → Codex 設計レビュー
  → 承認 → plan → 実装)で開始できる状態になっている

## 14. リスク・未決事項

- **リスク**: 方針ファイルが fork に波及し、fork 側の運用と齟齬を生む可能性 → 各ファイル冒頭の
  「参考扱い」明記と README で緩和。将来、fork 向けに一部を削除する仕組みが必要になれば別途検討。
- **未決**: 将来 CI を導入する時期・トリガー(体制やリリース頻度の変化で再検討)。
- **未決**: 独立 ADR 体系を導入するか(当面は spec 集約で運用し、決定が増えたら再検討)。
