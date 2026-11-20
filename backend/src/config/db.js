
import fs from 'node:fs';
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  options: `-c timezone=${process.env.DB_TIMEZONE || 'Asia/Kolkata'}`,
  ssl: env.nodeEnv === 'production' && process.env.DB_SSL === 'true'
    ? {
        rejectUnauthorized: true,
        ca: fs.readFileSync('/etc/secrets/supabase-ca.crt', 'utf8'),
      }
    : false,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
