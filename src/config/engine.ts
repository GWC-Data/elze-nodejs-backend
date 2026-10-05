import './env';
import path from 'path';
import { optional } from './configError';
import { DASHBOARD_CONFIG_DIR } from './env';

const DB_SCHEMA = optional('DB_SCHEMA', 'public');
const REDIS_URL = process.env.REDIS_URL;
const REDIS_TTL = parseInt(process.env.REDIS_TTL || '300', 10);
const CACHE_PREFIX = process.env.CACHE_PREFIX || 'bi';
const DASHBOARD_DIR = process.env.DASHBOARD_DIR ? path.resolve(process.env.DASHBOARD_DIR) : DASHBOARD_CONFIG_DIR;
const DEFAULT_DASHBOARD_ID = process.env.DEFAULT_DASHBOARD_ID || 'default';

export { DB_SCHEMA, REDIS_URL, REDIS_TTL, CACHE_PREFIX, DASHBOARD_DIR, DEFAULT_DASHBOARD_ID };
