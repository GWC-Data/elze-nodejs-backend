import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

function findBackendRoot(start: string): string {
  let dir = start;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no package.json above ${start}`);
    dir = parent;
  }
  return dir;
}

const BACKEND_ROOT = findBackendRoot(__dirname);
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');
const CONFIG_DIR = path.join(BACKEND_ROOT, 'src', 'config');

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const DIST_DIR = path.join(PROJECT_ROOT, 'frontend', 'dist');
const DASHBOARD_CONFIG_DIR = path.join(CONFIG_DIR, 'dashboards');
const MIGRATIONS_DIR = path.join(BACKEND_ROOT, 'prisma', 'migrations');
const OPENAPI_FILE = path.join(BACKEND_ROOT, 'docs', 'openapi.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export { BACKEND_ROOT, DIST_DIR, DASHBOARD_CONFIG_DIR, MIGRATIONS_DIR, OPENAPI_FILE, IS_PRODUCTION };
