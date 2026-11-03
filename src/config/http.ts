import './env';
import { optional, integer } from './configError';

function trustProxy(): boolean | number | string {
  const raw = String(optional('TRUST_PROXY', 'false')).toLowerCase();
  if (raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^d+$/.test(raw)) return Number(raw);
  return raw;
}

const TRUST_PROXY = trustProxy();
const RATE_LIMIT_PER_MINUTE = integer('RATE_LIMIT_PER_MINUTE', 1000, { min: 1 });
const AUTH_RATE_LIMIT_PER_15_MIN = integer('AUTH_RATE_LIMIT_PER_15_MIN', 20, { min: 1 });

export { TRUST_PROXY, RATE_LIMIT_PER_MINUTE, AUTH_RATE_LIMIT_PER_15_MIN };
