#!/bin/sh
# Runs once, the first time the MySQL volume is created. Adds the isolated database used by `npm run test:e2e`.
set -eu
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE%_dev}_test\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE%_dev}_test\`.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
