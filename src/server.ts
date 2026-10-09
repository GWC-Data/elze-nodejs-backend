import type { Server } from 'http';
import config from './config';
import app from './app';
import { bootstrapWithRetry, verifyEmailTransport, startHousekeeping } from './services/bootstrapService';

const { APPLICATION_URL } = config.auth;
const { db } = config.database;

const PORT = process.env.PORT || 8080;
const SHUTDOWN_GRACE_MS = 10000;

let server: Server | null = null;
let shuttingDown = false;

async function start(): Promise<void> {
  try {
    await bootstrapWithRetry();
  } catch {
    process.exit(1);
  }
  await verifyEmailTransport();
  startHousekeeping();

  server = app.listen(PORT, (err?: any) => {
    if (err) {
      console.error(`[startup] cannot listen on port ${PORT}: ${err.code || err.message}`);
      if (err.code === 'EADDRINUSE') {
        console.error('[startup] another process owns this port - often the docker-compose `web` container. Stop it or set PORT.');
      }
      process.exit(1);
    }
    console.log(`Backend running on http://localhost:${PORT}`);
    console.log(`Application URL (used in email links): ${APPLICATION_URL}`);
  });
}

function shutdown(signal: string): void {
  console.log(`[shutdown] received ${signal}`);
  if (shuttingDown) return;
  shuttingDown = true;

  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();

  const closeServer = server
    ? new Promise<void>((resolve) => server!.close(() => resolve()))
    : Promise.resolve();

  closeServer
    .then(() => db.end())
    .catch((err) => console.warn('[shutdown] cleanup failed:', err.message))
    .finally(() => process.exit(0));
}

function die(kind: string, err: unknown): void {
  const detail = err instanceof Error ? err.stack || err.message : JSON.stringify(err);
  console.error(`[fatal] ${kind}: ${detail}`);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
}

process.on('unhandledRejection', (err) => die('unhandled promise rejection', err));
process.on('uncaughtException', (err) => die('uncaught exception', err));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

start().catch((err) => {
  console.error('[startup] failed:', err.stack || err.message);
  process.exit(1);
});
