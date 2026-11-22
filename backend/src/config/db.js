
import fs from 'node:fs';
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

function getSslConfig() {
  if (env.nodeEnv !== 'production' && process.env.DB_SSL !== 'true') {
    return false;
  }

  const caPath = process.env.DB_SSL_CA_PATH || '/etc/secrets/supabase-ca.crt';
  if (fs.existsSync(caPath)) {
    try {
      const ca = fs.readFileSync(caPath, 'utf8');
      return { rejectUnauthorized: true, ca };
    } catch (e) {
      console.warn('Warning: Unable to read CA file at', caPath, e.message);
    }
  }

  if (process.env.DB_SSL === 'strict') {
    throw new Error(`Production DB_SSL is set to 'strict' but no CA certificate found at ${caPath}`);
  }

  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: env.databaseUrl,
  options: `-c timezone=${process.env.DB_TIMEZONE || 'Asia/Kolkata'}`,
  ssl: getSslConfig(),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
