/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const mysql2 = require('mysql2');

/**
 * A mysql2 wrapper that forces every pooled connection onto UTC.
 *
 * TypeORM's `timezone: 'Z'` only tells the JS side how to interpret DATETIME values; it does NOT set the
 * MySQL session time zone. Without this, `DEFAULT CURRENT_TIMESTAMP(3)` and `ON UPDATE CURRENT_TIMESTAMP(3)`
 * would be written in the server's local zone (e.g. IST) and then read back as UTC, shifting every timestamp.
 * Setting it per connection removes any dependence on how the MySQL server happens to be configured.
 */
export const mysqlUtcDriver = {
  ...mysql2,
  createPool(config: unknown) {
    const pool = mysql2.createPool(config);
    pool.on('connection', (connection: any) => connection.query("SET time_zone = '+00:00'"));
    return pool;
  },
};
