#!/usr/bin/env bash
set -euo pipefail
if ! git remote | grep -qx upstream; then
  echo "upstream 未登録です。次を実行してください:"
  echo "  git remote add upstream <社内Gitのテンプレートrepo URL>"
  exit 1
fi
REF="${1:-upstream/main}"
git fetch upstream
echo "merging ${REF} ..."
if ! git merge "${REF}"; then
  echo "衝突しました。所有権表は docs（README の所有権表）を参照して手動解決してください。"
  echo "テンプレート所有パスは原則 fork 側で編集しません。"
  exit 1
fi
