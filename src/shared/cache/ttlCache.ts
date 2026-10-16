interface TtlEntry {
  value: any;
  expires: number;
}

class TtlCache {
  declare ttl: number;
  declare store: Map<string, TtlEntry>;
  declare timer: NodeJS.Timeout;

  constructor(ttlMs?: number) {
    this.ttl = ttlMs || 5 * 60 * 1000;
    this.store = new Map();
    this.timer = setInterval(() => this.cleanup(), Math.min(60000, this.ttl));
    if (this.timer.unref) this.timer.unref();
  }

  get(key: string): any {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: any, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expires: Date.now() + (ttlMs || this.ttl),
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expires <= now) this.store.delete(key);
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }
}

export = TtlCache;
