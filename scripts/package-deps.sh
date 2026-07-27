#!/usr/bin/env bash
set -euo pipefail
# package.json の playwright バージョンを読む
PW_VERSION=$(node -p "require('./package.json').dependencies.playwright")
mkdir -p vendor
# 1) node_modules.tar.gz
npm ci
tar czf vendor/node_modules.tar.gz node_modules
# 2) ベースイメージ save(バージョン一致)
docker pull "mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
docker save -o vendor/playwright-base.tar "mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
echo "wrote vendor/node_modules.tar.gz and vendor/playwright-base.tar"
