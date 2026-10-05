import crypto from 'crypto';
import type RedisClient from 'ioredis';
import TtlCache from './ttlCache';

interface QueryCacheOptions {
  ttl?: number;
  prefix?: string;
}

class QueryCache {
  declare redis: RedisClient | null;
  declare redisEnabled: boolean;
  declare ttl: number;
  declare prefix: string;
  declare memory: TtlCache;

  constructor(redisUrl?: string | null, options?: QueryCacheOptions) {
    this.redis = null;
    this.redisEnabled = false;
    this.ttl = (options && options.ttl) || 300;
    this.prefix = (options && options.prefix) || 'bi';

    this.memory = new TtlCache(this.ttl * 1000);

    if (!redisUrl) {
      console.log('[QueryCache] No Redis URL provided, using in-memory cache');
      return;
    }

    try {
      const Redis: typeof import('ioredis').default = require('ioredis');
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        lazyConnect: true,
        retryStrategy(times: number) {
          if (times > 1) return null;
          return 500;
        },
      });

      this.redis.on('connect', () => {
        this.redisEnabled = true;
        console.log('[QueryCache] Redis connected');
      });

      this.redis.on('error', (err: Error) => {
        if (this.redisEnabled) {
          console.log('[QueryCache] Redis error, falling back to in-memory:', err.message);
        }
        this.redisEnabled = false;
      });

      this.redis.on('close', () => {
        this.redisEnabled = false;
      });

      this.redis.connect().catch(() => {
        console.log('[QueryCache] Redis unavailable, using in-memory cache');
      });
    } catch (err: any) {
      console.log('[QueryCache] Redis module not available, using in-memory cache:', err.message);
    }
  }

  _hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  _namespace(dashboardKey: unknown): string {
    const raw = String(dashboardKey == null || dashboardKey === '' ? 'default' : dashboardKey);
    const safe = raw.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 64);
    return safe === raw ? safe : `${safe}~${this._hash(raw).slice(0, 8)}`;
  }

  generateKey(dashboardKey: unknown, type: string, sql: string, params?: unknown): string {
    const canonical = [type, sql, params ? JSON.stringify(params) : ''].join('\u0000');
    const hash = this._hash(canonical);
    return `${this.prefix}:${this._namespace(dashboardKey)}:${hash}`;
  }

  async get(key: string): Promise<any> {
    const memHit = this.memory.get(key);
    if (memHit !== undefined) return memHit;

    if (!this.redisEnabled || !this.redis) return null;
    try {
      const data = await this.redis.get(key);
      if (!data) return null;
      const parsed = JSON.parse(data);
      this.memory.set(key, parsed);
      return parsed;
    } catch (err: any) {
      console.log('[QueryCache] GET error:', err.message);
      return null;
    }
  }

  async set(key: string, data: unknown, ttl?: number): Promise<void> {
    this.memory.set(key, data, (ttl || this.ttl) * 1000);
    if (!this.redisEnabled || !this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(data), 'EX', ttl || this.ttl);
    } catch (err: any) {
      console.log('[QueryCache] SET error:', err.message);
    }
  }

  async invalidate(pattern?: string): Promise<void> {
    this.memory.invalidatePrefix(pattern || this.prefix);

    if (!this.redisEnabled || !this.redis) return;
    const match = pattern ? `${pattern}*` : `${this.prefix}:*`;
    try {
      let cursor = '0';
      let removed = 0;
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', match, 'COUNT', 200);
        cursor = next;
        if (keys.length) {
          await this.redis.unlink(...keys).catch(() => this.redis!.del(...keys));
          removed += keys.length;
        }
      } while (cursor !== '0');
      if (removed) console.log(`[QueryCache] Invalidated ${removed} keys`);
    } catch (err: any) {
      console.log('[QueryCache] INVALIDATE error:', err.message);
    }
  }

  async disconnect(): Promise<void> {
    this.memory.stop();
    if (this.redis) {
      try { await this.redis.quit(); } catch (_) {}
    }
  }
}

export = QueryCache;
