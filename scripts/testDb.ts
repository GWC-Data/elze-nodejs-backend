import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { BACKEND_ROOT } from '../src/config/env';
import { quoteIdentifier } from '../src/tools/sql';

interface Suite {
  file: string;
  needsServer: boolean;
}

const SUITES: Record<string, Suite> = {
  e2e: { file: 'tests/rbac.e2e.ts', needsServer: true },
  context: { file: 'tests/contextLayer.test.ts', needsServer: false },
  dashboard: { file: 'tests/dashboard_lifecycle.test.ts', needsServer: false },
};

const SERVER_READY_TIMEOUT_MS = 90_000;
const SERVER_LOG_LINES = 200;

const target = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: Number(process.env.TEST_DB_PORT || 5432),
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD ?? 'postgres',
  database: process.env.TEST_DB_NAME || 'elze_test',
};
const serverPort = Number(process.env.TEST_SERVER_PORT || 8099);
const smtpPort = Number(process.env.TEST_SMTP_PORT || 2525);
const serverUrl = `http://localhost:${serverPort}`;

function suiteEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: target.host,
    DB_DIRECT_HOST: '',
    DB_PORT: String(target.port),
    DB_USER: target.user,
    DB_PASSWORD: target.password,
    DB_NAME: target.database,
    DB_SSL: 'false',
    DB_SSL_REJECT_UNAUTHORIZED: 'false',
    REDIS_URL: '',
    PORT: String(serverPort),
    APPLICATION_URL: serverUrl,
    JWT_ACCESS_SECRET: 'test-only-access-token-secret',
    JWT_REFRESH_SECRET: 'test-only-refresh-token-secret',
    CREDENTIAL_SECRET: 'test-only-credential-secret-at-least-32-chars',
    BOOTSTRAP_ADMIN_USERNAME: 'platformowner',
    BOOTSTRAP_ADMIN_EMAIL: 'owner@example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'ChangeMeAtFirstSignIn1!',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(smtpPort),
    SMTP_SECURE: 'false',
    SMTP_USERNAME: '',
    SMTP_PASSWORD: '',
    EMAIL_FROM: 'tests@example.com',
    E2E_BASE: serverUrl,
    E2E_SMTP_PORT: String(smtpPort),
  };
}

function parseArgs(argv: string[]): { suites: string[]; keep: boolean } {
  const keep = argv.includes('--keep');
  const names = argv.filter((arg) => arg !== '--keep');
  const unknown = names.filter((name) => !SUITES[name]);
  if (unknown.length) {
    console.error(`Unknown suite: ${unknown.join(', ')}. Choose from ${Object.keys(SUITES).join(', ')}.`);
    process.exit(2);
  }
  return { suites: names.length ? names : Object.keys(SUITES), keep };
}

function refuseSharedDatabase(): void {
  const sameHost = (process.env.DB_HOST || '') === target.host;
  const sameName = (process.env.DB_NAME || '') === target.database;
  if (sameHost && sameName) {
    console.error(
      `TEST_DB_NAME is ${target.database} on ${target.host}, which is the database .env points at. ` +
        'The test runner drops its database; give it a separate one.'
    );
    process.exit(2);
  }
}

async function onServer(work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ ...target, database: 'postgres' });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}

async function recreateDatabase(): Promise<void> {
  const name = quoteIdentifier(target.database);
  await onServer(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  });
}

async function dropDatabase(): Promise<void> {
  await onServer(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(target.database)} WITH (FORCE)`);
  });
}

function prismaCli(): string {
  const packageDir = path.join(BACKEND_ROOT, 'node_modules', 'prisma');
  const { bin } = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return path.join(packageDir, typeof bin === 'string' ? bin : bin.prisma);
}

function run(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: BACKEND_ROOT, env: suiteEnv(), stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function migrate(): Promise<void> {
  const code = await run([prismaCli(), 'migrate', 'deploy']);
  if (code !== 0) throw new Error(`prisma migrate deploy exited with ${code}`);
}

async function answers(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

function startServer(): { server: ChildProcess; log: string[] } {
  const log: string[] = [];
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: BACKEND_ROOT,
    env: suiteEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keep = (chunk: Buffer) => {
    log.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
    log.splice(0, Math.max(0, log.length - SERVER_LOG_LINES));
  };
  server.stdout?.on('data', keep);
  server.stderr?.on('data', keep);
  return { server, log };
}

async function waitUntilReady(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the server exited with code ${server.exitCode} while starting`);
    if (await answers(`${serverUrl}/api/health`)) return;
    await delay(500);
  }
  throw new Error(`the server did not answer within ${SERVER_READY_TIMEOUT_MS / 1000}s`);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
}

async function runSuite(name: string): Promise<boolean> {
  const suite = SUITES[name];
  console.log(`\n=== ${name}: ${suite.file} against ${target.database} on ${target.host}:${target.port}`);
  await recreateDatabase();
  await migrate();

  if (!suite.needsServer) return (await run(['--import', 'tsx', suite.file])) === 0;

  if (await answers(`${serverUrl}/api/health`)) {
    throw new Error(`something already answers on port ${serverPort}; stop it or set TEST_SERVER_PORT`);
  }
  const { server, log } = startServer();
  try {
    await waitUntilReady(server);
    const passed = (await run(['--import', 'tsx', suite.file])) === 0;
    if (!passed) console.log(`\n--- last ${log.length} lines of server output\n${log.join('\n')}`);
    return passed;
  } catch (err) {
    console.log(`\n--- server output\n${log.join('\n')}`);
    throw err;
  } finally {
    await stopServer(server);
  }
}

async function main(): Promise<void> {
  const { suites, keep } = parseArgs(process.argv.slice(2));
  refuseSharedDatabase();

  const results: [string, boolean][] = [];
  try {
    for (const name of suites) results.push([name, await runSuite(name)]);
  } finally {
    if (!keep) await dropDatabase();
  }

  console.log('\n=== summary');
  for (const [name, passed] of results) console.log(`${passed ? 'pass' : 'FAIL'}  ${name}`);
  process.exitCode = results.every(([, passed]) => passed) ? 0 : 1;
}

main().catch((err) => {
  console.error(`\ntest run aborted: ${err.message}`);
  process.exitCode = 1;
});
