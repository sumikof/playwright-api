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

- fork した各システム側の運用(強制しない)。fork は upstream 所有の方針ファイルを
  **編集・削除しない**。運用の「上書き」はファイルの書き換えではなく、fork 所有の `FORK.md` に
  よる指示の上書き(opt-out)を意味する(§10 参照)
- CI・ブランチ保護の実導入(当面見送り。将来 TODO として記載のみ)
- 独立 ADR 体系の導入(当面は spec 内に集約)

## 3. 確定した設計判断(ブレインストーミングでユーザー承認済み)

| 論点 | 決定 |
|---|---|
| 運用の骨格 | 両者を統合した**折衷版**。superpowers を土台に方針書のゲートを重ねる |
| 独立レビュー担当 | **Codex を正式採用**(GitHub PR の `@codex review`、設定済み)。`AGENTS.md` を新設 |
| 適用範囲 | **テンプレート開発のみ**。fork では **default-on だが強制せず、`FORK.md` で解除可能**(§10) |
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

- **冒頭に FORK.md 分岐**: リポジトリ直下に `FORK.md` が存在する場合、以下のテンプレート運用指示は
  適用せず `FORK.md` に従う(§10 参照)
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

- **冒頭に FORK.md 分岐**: リポジトリ直下に `FORK.md` が存在する場合、以下のテンプレート運用指示は
  適用せず `FORK.md` に従う(§10 参照)
- Issue、spec、実装コード、テストを相互に照合する
- 設計フェーズと実装フェーズでレビュー観点を切り替える
- 重大なバグ・回帰・セキュリティ問題を優先し、重大度・発生条件・影響・根拠・最小修正案を示す
- 好みや根拠のないスタイル指摘を避ける
- 情報不足時は推測で断定せず不足情報を示す
- プロジェクト固有の互換要件は `docs/engineering-standards.md` の固定バージョン方針への**適合を確認する**
  責任のみを負う(Playwright の npm 版とイメージタグ一致などの具体規則は共通基準側にのみ置き、
  ここには再掲しない)
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
5. Claude が各指摘の妥当性を検証 → spec 修正。対応しない指摘は根拠を PR に記録
6. **spec を変更したら最新 SHA で `@codex review` を再実行**する(設計レビューの再取得)。
   spec に実質的な変更がある限り、「最後に Codex が設計レビューした SHA」が最新コミットに
   一致するまで承認へ進まない
7. ユーザーが PR で設計承認コメント(定型文)。**承認時 HEAD = 承認対象 SHA =
   最後に Codex が設計レビューした SHA の三者一致を必須**とする(spec 以外のコミットが
   入っていても未レビューの HEAD を承認扱いにしない)。承認前は実装しない
8. 承認後 = `superpowers:writing-plans` で plan 作成
9. **plan 整合性チェック(実装前ゲート、双方向)**:
   - (plan → spec)plan の各タスクが spec と受け入れ条件に対応すること
   - (spec → plan)spec の全要件・全受け入れ条件が、少なくとも一つの実装または検証タスクに
     対応していること(丸ごと欠落したタスクを検出する)
   不整合があれば原因で分岐する:
   - **plan 側の欠陥**(タスクの書き忘れ・余計なタスク等、承認済み spec 自体は妥当)
     → plan を修正し双方向チェックを再実行する(spec や承認は変更しない)
   - **新しい設計判断が必要 / spec 自体の変更が必要**(plan が spec に無い設計判断を追加、
     承認済み設計から逸脱、要件の過不足が spec 起因)
     → 実装に入らず spec を更新して §7 手順 4〜7(設計レビュー + 承認)へ戻す

   承認済み要件を削って plan に合わせる(整合性の帳尻合わせ)は禁止する。
10. `superpowers:executing-plans` または `superpowers:subagent-driven-development` で実装 + テスト
11. ローカル検証(`npm test`, `npx playwright test` 等)の結果を PR に記録し、Draft 解除
12. `@codex review`(最終レビュー用テンプレ)。最終レビュー対象 SHA を記録
13. **最終レビュー指摘の解消(受け入れの前提)**: 最新レビューの全指摘について、Claude が
    妥当性を検証し、次のいずれかで決着させる — (a) 修正 → **手順11 のローカル検証を再実行**して
    結果を PR に更新 → 最新 SHA で再レビュー(手順12)、または (b) 非対応の根拠を PR に記録し、
    ユーザーが明示的に受け入れる。(a) の修正を行えばその時点で従前の最終レビューは**無効化**され、
    手順11→12 をやり直す(未検証の修正のまま次へ進まない)。未決着の指摘が残る限り手順14へ進まない
14. ユーザー受け入れ確認(方針書のチェックリスト形式)。**受け入れ対象 SHA を明記**し、
    最新レビューの全指摘が上記 (a)/(b) で決着済みであることを確認する
15. ユーザーがマージ(直前に `Closes #<N>` へ変更)。**マージ時 HEAD = 受け入れ対象 SHA =
    Codex 最終レビュー済み SHA の三者一致を必須**とする(CI・ブランチ保護が無いため、この一致は
    人間が手動で確認する)。→ Issue close、残課題は別 Issue へ

### SHA 一致の不変条件(自動ゲートが無い運用の要)

- **設計承認**: 承認時 HEAD = 承認 SHA = 最後に Codex が設計レビューした SHA(三者一致)
- **最終マージ**: マージ時 HEAD = ユーザー受け入れ SHA = Codex 最終レビュー済み SHA(三者一致)
- **無効化の対象期間を区別する**(常に最新 HEAD で再レビューを要求するわけではない):
  - **設計レビュー**は「承認までの spec 変更」で無効化する。承認後の plan 作成や通常の実装
    コミットでは設計レビューを無効化しない(それらは §7 手順9 と「設計レビューへ戻す条件」に
    従い、重大な設計変更のときだけ設計レビューへ戻す)
  - **最終レビュー**は「受け入れまでの spec / コード / テスト変更」で無効化する
- 最新レビューの全指摘は「修正して再レビュー」か「非対応の根拠記録 + ユーザー明示受け入れ」で
  決着してから次工程へ進む。CI・ブランチ保護でこれを機械的に強制できないため、**PR 上での
  SHA 記録と人間の目視確認**で担保する

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

- **同時 writer は主エージェントを含めて全体で1**とする(サブエージェントだけを数えるのではない)。
  ファイル・生成物・Git 状態を変更する作業は、主エージェント + サブエージェントを合わせて
  常に高々1つに限る(方針書 5.1 準拠)。
- **read-only の定義**: 作業ツリー・リポジトリ状態・Git 状態・生成物/キャッシュのいずれも
  変更しない操作(検索・読取・成果物を残さない解析等)。これらに限り複数を並列してよい。
- read-only 並列の上限はハーネスの既定同時実行数に従う。依存インストール、キャッシュ生成、
  `git` 状態の変更などを伴う調査コマンドは read-only とみなさず、直列の writer 枠で扱う。

## 10. 適用範囲と fork 配慮

方針ファイル(`CLAUDE.md` / `AGENTS.md` / `docs/engineering-standards.md` /
`docs/operations/ai-workflow-policy.md` / 将来の CI)は **upstream 所有**でありテンプレート開発用。

- fork は**これらを削除・編集しない**。削除・編集すると upstream merge 時に modify/delete または
  内容競合を招くため(既存の「demo-app は残す」方針と同じ理由)。
- **fork の opt-out は「fork 所有・upstream に存在しないマーカーファイル」で行う**:
  - fork はリポジトリ直下に `FORK.md`(upstream には存在しない、fork 所有)を作成し、
    自システムの運用を記述する。
  - upstream 所有の `CLAUDE.md` / `AGENTS.md` は**冒頭に次の分岐を明記**する:
    「**リポジトリ直下に `FORK.md` が存在する場合、本ファイルのテンプレート運用指示
    (Issue → Draft PR → Codex → …)は適用せず、`FORK.md` の指示に従う**」。
  - これにより、未変更の fork ではテンプレート運用が有効、opt-out したい fork は upstream 所有
    ファイルを一切触らず `FORK.md` を1つ追加するだけで切替できる(upstream が同ファイルを
    更新しても衝突しない)。
- README にもこの opt-out 手順(`FORK.md` を置く)を明記する。

> 補足: 冒頭に「参考扱い」と書くだけでは、未変更 fork でも AI ツールが root の
> `CLAUDE.md` / `AGENTS.md` を自動読込するため運用指示が実質有効になってしまう。マーカーファイルに
> よる明示的 opt-out はこの読込を分岐で無効化するための仕組みである。

## 11. 直近の offline/Docker/OpenShift 作業への適用

- 既存 spec `docs/superpowers/specs/2026-07-24-offline-docker-openshift-design.md` は作成済み。
- 本ワークフローでは次から開始する:
  1. Issue 起票(offline/Docker/OpenShift 対応)
  2. Draft PR 作成(`Relates to #<N>`)
  3. 既存 spec を `@codex review`(設計レビュー)
  4. ユーザー設計承認(承認 SHA = 設計レビュー済み SHA)
  5. `superpowers:writing-plans` で
     `docs/superpowers/plans/2026-07-24-offline-docker-openshift.md` を作成
  6. plan 整合性チェック(plan ↔ spec / 受け入れ条件の対応確認)
  7. 実装(Phase 1〜4)
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
| `README.md` 追記 | 運用フロー概要、fork の opt-out 手順(`FORK.md` を置く / §10) |

`CLAUDE.md` と `AGENTS.md` は冒頭に FORK.md 分岐(§10)を含める。

## 13. 受け入れ条件

成果物・方針が以下をすべて満たすとき本設計を完了とする。各条件は成果物内の対応箇所まで
検証できること。

**ワークフローの明文化(`docs/operations/ai-workflow-policy.md`)**

- §7 の全工程が記載されている: Issue → Draft PR → 設計 → Codex 設計レビュー → 再レビュー →
  設計承認 → plan → plan 整合性チェック → 実装 → ローカル検証 → Codex 最終レビュー →
  再レビュー → ユーザー受け入れ → マージ → Issue close(残課題は別 Issue)
- 設計レビューへ戻す条件(§7 の該当節)が記載されている
- plan 整合性チェックが**双方向**(plan→spec と spec→plan の両網羅)で記載されている
- SHA 一致の不変条件が記載されている(承認時 HEAD = 承認 SHA = 設計レビュー済み SHA の三者一致、
  マージ時 HEAD = 受け入れ SHA = 最終レビュー済み SHA の三者一致)
- 最終レビュー指摘の決着ルール(修正+再レビュー、または非対応根拠記録+ユーザー明示受け入れ)が
  受け入れ・マージの前提として記載されている
- CI 見送り時の手動ゲート(ローカル検証コマンド + チェックリスト + 人間の承認・受け入れ・マージ)が
  記載されている
- サブエージェント制約(同時 writer 全体で1、read-only の定義と並列上限)が記載されている

**指示ファイル**

- `CLAUDE.md` / `AGENTS.md` / `docs/engineering-standards.md` が作成されている
- 具体的な互換規則(Playwright の npm 版とイメージタグ一致等)は
  `docs/engineering-standards.md` にのみ存在し、`AGENTS.md` は適合確認責任のみを記載している
- `CLAUDE.md` / `AGENTS.md` 冒頭に FORK.md 分岐が記載されている

**テンプレート**

- `.github/pull_request_template.md`(方針書 §8 構成)が利用可能
- Codex 設計/最終レビュー依頼テンプレが利用可能

**fork 配慮**

- fork は upstream 所有ファイルを削除・編集せず `FORK.md` 追加のみで opt-out できることが
  明記され、README にも手順がある

**直近作業への接続**

- offline/Docker/OpenShift 作業が本フロー(Issue → Draft PR → Codex 設計レビュー → 承認 →
  plan → plan 整合性チェック → 実装)で開始できる状態になっている

## 14. リスク・未決事項

- **リスク**: 方針ファイルが fork に波及し、fork 側の運用と齟齬を生む可能性 → upstream 所有ファイルは
  fork 側で削除・編集させず、fork 所有の `FORK.md`(§10)による明示的 opt-out で切替える設計とした
  (削除に伴う modify/delete 衝突を回避)。将来 opt-out の粒度を上げる必要があれば別途検討。
- **未決**: 将来 CI を導入する時期・トリガー(体制やリリース頻度の変化で再検討)。
- **未決**: 独立 ADR 体系を導入するか(当面は spec 集約で運用し、決定が増えたら再検討)。
