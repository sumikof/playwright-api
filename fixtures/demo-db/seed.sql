-- demo-db: products テーブル(demo-app の商品一覧 A/B/C に対応)
--
-- SQLite / Oracle の双方で通る最小限の SQL に留める(1 文 1 行の INSERT、型は INTEGER / VARCHAR)。
-- SQLite: npx tsx fixtures/demo-db/seed.ts ./demo.sqlite
-- Oracle: SQL*Plus / SQL Developer などで各文を実行する(文末の ; の扱いはツールに従う)。
--         INSERT の後に必ず COMMIT; を実行すること(自動コミット無効のセッションでは、未コミットの
--         行は API の別接続から見えず /queries/products が 0 件になる)。COMMIT をこのファイルに
--         含めないのは、SQLite ではトランザクション外の COMMIT がエラーになるため。
CREATE TABLE products (
  id    INTEGER PRIMARY KEY,
  name  VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL
);
INSERT INTO products (id, name, price) VALUES (1, '商品A', 120);
INSERT INTO products (id, name, price) VALUES (2, '商品B', 480);
INSERT INTO products (id, name, price) VALUES (3, '商品C', 980);
