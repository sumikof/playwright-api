#!/usr/bin/env bash
set -euo pipefail
if ! git remote | grep -qx upstream; then
  echo "upstream 未登録です。次を実行してください:"
  echo "  git remote add upstream <社内Gitのテンプレートrepo URL>"
  exit 1
fi
git fetch upstream --tags
if [ $# -ge 1 ]; then
  if git rev-parse -q --verify "upstream/$1" >/dev/null; then
    TARGET="upstream/$1"                                    # upstream のブランチ
  elif git ls-remote --exit-code --tags upstream "refs/tags/$1" >/dev/null 2>&1; then
    TARGET="refs/tags/$1"                                   # upstream のタグ(存在を確認済み)
  else
    # ローカルの同名 ref / SHA / 別 remote 由来の ref は許可しない(upstream に無ければ失敗させる)
    echo "ref '$1' が upstream に見つかりません（ブランチ=upstream/$1、タグ=$1 のいずれも不在）"
    exit 1
  fi
else
  TARGET="upstream/main"
fi
echo "merging ${TARGET} ..."
if ! git merge "${TARGET}"; then
  echo "衝突しました。所有権表は docs（README の所有権表）を参照して手動解決してください。"
  echo "テンプレート所有パスは原則 fork 側で編集しません。"
  exit 1
fi
