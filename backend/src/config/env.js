import dotenv from 'dotenv';
import path from 'path';

dotenv.config();
// Also load the project-root .env when the backend is started from its own directory.
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
const jwtSecret = process.env.JWT_SECRET || 'dev_insecure_jwt_secret_change_in_production';
const encryptionKey = process.env.ENCRYPTION_KEY || jwtSecret;
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || jwtSecret.includes('change_in_production') || !process.env.ENCRYPTION_KEY || encryptionKey===jwtSecret || encryptionKey.length < 32 || encryptionKey.includes('change_in_production'))) throw new Error('Production requires separate strong JWT_SECRET and ENCRYPTION_KEY values (32+ characters each).');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://ironpulse_admin:change_this_local_db_password@localhost:5432/ironpulse_gym',
  jwtSecret,
  encryptionKey,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
