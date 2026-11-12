import fs from 'node:fs';
import path from 'node:path';
import config from '../../config';
import * as bootstrapRepository from './bootstrapRepository';
import * as dashboardRepository from '../dashboards/dashboardRepository';
import { loadCatalogue } from '../catalogue/catalogueService';
import { normalizeSpec } from '../dashboards/cardModel';
import { seed } from '../../../prisma/seed';
import { pruneExpiredTokens } from '../auth/tokenService';
import { pruneAttempts } from '../auth/loginThrottleService';
import { verifyTransport } from '../../shared/email/emailService';
import { codeOf, messageOf } from '../../shared/errors/AppError';

const { DASHBOARD_CONFIG_DIR, MIGRATIONS_DIR } = config.env;

const HOUSEKEEPING_INTERVAL_MS = 6 * 60 * 60 * 1000;

let ready = false;

function isRbacReady(): boolean {
  return ready;
}

async function seedDefaultDashboards(): Promise<void> {
  if (!dashboardRepository.fileExists(DASHBOARD_CONFIG_DIR)) return;
  let files: string[] = [];
  try {
    files = dashboardRepository.listJsonFiles(DASHBOARD_CONFIG_DIR);
  } catch (_) {
    return;
  }

  for (const file of files) {
    try {
      const id = path.basename(file, '.json');
      const spec = normalizeSpec(dashboardRepository.readJsonFile(path.join(DASHBOARD_CONFIG_DIR, file)));
      await bootstrapRepository.insertDashboardIfMissing({
        id,
        title: spec.title || id,
        description: spec.description || null,
        spec,
      });
    } catch (err) {
      console.warn(`[rbac] failed to seed dashboard from ${file}:`, messageOf(err));
    }
  }
}

function migrationNames(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function assertMigrated(): Promise<void> {
  const applied = new Set(await bootstrapRepository.appliedMigrations());
  const pending = migrationNames().filter((name) => !applied.has(name));
  if (pending.length) {
    throw new Error(
      `the database is missing migration(s) ${pending.join(', ')}. Run "npm run db:migrate" before starting the server.`
    );
  }
}

async function bootstrapAppMeta(): Promise<boolean> {
  try {
    await assertMigrated();
    await seed();
    await loadCatalogue();
    await seedDefaultDashboards();

    const roleless = await bootstrapRepository.countUsersWithoutRole();
    if (roleless)
      console.warn(`[rbac] ${roleless} account(s) have no role in access_control.user_roles and cannot sign in`);

    ready = true;
    return true;
  } catch (err) {
    ready = false;
    throw err;
  }
}

async function bootstrapWithRetry(attempts: number = 5, delayMs: number = 3000): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await bootstrapAppMeta();
      console.log('[rbac] metadata database ready');
      return;
    } catch (err) {
      const last = attempt === attempts;
      console.warn(
        `[rbac] bootstrap failed (${codeOf(err) || messageOf(err)})${last ? '' : `, retrying in ${delayMs / 1000}s...`}`
      );
      if (last) {
        console.error('[rbac] giving up. The metadata database must be reachable to serve any request.');
        console.error(`[rbac] last error: ${messageOf(err)}`);
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function verifyEmailTransport(): Promise<void> {
  try {
    await verifyTransport();
    console.log('[email] SMTP relay reachable and credentials accepted');
  } catch (err) {
    console.warn(`[email] SMTP is not usable: ${messageOf(err)}. Creating a user will fail until this is fixed.`);
  }
}

function startHousekeeping(): NodeJS.Timeout {
  const runOnce = async () => {
    try {
      const tokens = await pruneExpiredTokens();
      const attempts = await pruneAttempts();
      if (tokens || attempts) {
        console.log(`[housekeeping] pruned ${tokens} token row(s), ${attempts} login-attempt row(s)`);
      }
    } catch (err) {
      console.warn('[housekeeping] prune failed:', messageOf(err));
    }
  };
  void runOnce();
  return setInterval(runOnce, HOUSEKEEPING_INTERVAL_MS).unref();
}

export { isRbacReady, bootstrapAppMeta, bootstrapWithRetry, verifyEmailTransport, startHousekeeping };
