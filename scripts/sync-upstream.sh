#!/usr/bin/env bash
set -euo pipefail
if ! git remote | grep -qx upstream; then
  echo "upstream 未登録です。次を実行してください:"
  echo "  git remote add upstream <社内Gitのテンプレートrepo URL>"
  exit 1
fi
# 取り込む ref は必ず upstream 上に存在することを ls-remote で確認し、その ref だけを
# 明示 fetch して FETCH_HEAD を merge する。ローカルの同名ブランチ・古い remote-tracking
# ref・SHA などを誤って取り込まないため、ローカル ref には一切依存しない。
REF="${1:-main}"
if git ls-remote --exit-code --heads upstream "refs/heads/${REF}" >/dev/null 2>&1; then
  git fetch upstream "refs/heads/${REF}"                    # upstream のブランチ(確認済み)
elif git ls-remote --exit-code --tags upstream "refs/tags/${REF}" >/dev/null 2>&1; then
  git fetch upstream "refs/tags/${REF}"                     # upstream のタグ(確認済み)
else
  echo "ref '${REF}' が upstream に見つかりません（ブランチ・タグのいずれも不在）"
  exit 1
fi
echo "merging upstream ${REF} (FETCH_HEAD) ..."
if ! git merge FETCH_HEAD; then
  echo "衝突しました。所有権表は docs（README の所有権表）を参照して手動解決してください。"
  echo "テンプレート所有パスは原則 fork 側で編集しません。"
  exit 1
fi
