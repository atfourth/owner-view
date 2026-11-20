import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';

import saasRoutes from './routes/saas.routes.js';

const app = express();
if (env.nodeEnv === 'production') app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      service: 'ironpulse-gym-api',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(503).json({
      status: 'degraded',
      service: 'ironpulse-gym-api',
      database: 'disconnected',
    });
  }
});

app.use('/api/saas/login', rateLimit({max:10,message:'Too many login attempts. Try again in 15 minutes.'}));
app.use('/api/saas/register', rateLimit({max:5,message:'Too many registration attempts. Try again later.'}));
app.use('/api/saas/public', rateLimit({max:10,message:'Too many check-in requests. Please wait before trying again.'}));
app.use('/api/saas', saasRoutes);
// Legacy single-tenant routers are intentionally not mounted; SaaS routes enforce gym scoping.


app.use(notFoundHandler);
app.use(errorHandler);

export default app;
