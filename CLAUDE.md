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
