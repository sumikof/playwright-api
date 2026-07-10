#!/usr/bin/env bash
# Chromium が Playwright 下で起動するのに必要な共有ライブラリを入れる。
# devcontainer feature の install.sh はビルド時に root で実行されるので sudo は不要。
#
# パッケージ一覧は `npx playwright install-deps --dry-run chromium` が示す
# apt パッケージに対応する。Playwright のバージョンを上げてライブラリが
# 増減したら、そのコマンドの出力に合わせてこの一覧を更新すること。
set -eux

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  fonts-liberation \
  libasound2t64 \
  libatk-bridge2.0-0t64 \
  libatk1.0-0t64 \
  libatspi2.0-0t64 \
  libcairo2 \
  libcups2t64 \
  libdbus-1-3 \
  libgbm1 \
  libglib2.0-0t64 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libx11-6 \
  libxcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2

rm -rf /var/lib/apt/lists/*
