import app from './app.js';
import { startReminderScheduler } from './jobs/reminders.js';
import { env } from './config/env.js';

app.listen(env.port, () => {
  startReminderScheduler();
  console.log(`IronPulse Gym API running on http://localhost:${env.port} (${env.nodeEnv})`);
});
