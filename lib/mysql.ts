import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST?.trim(),
      database: process.env.MYSQL_DATABASE?.trim(),
      user: process.env.MYSQL_USER?.trim(),
      password: process.env.MYSQL_PASSWORD?.trim(),
      waitForConnections: true,
      connectionLimit: 5,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
