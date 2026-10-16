import { fail } from '../../shared/errors/AppError';

interface Lane {
  active: number;
  lastStart: number;
  waiting: Array<() => void>;
  timer: NodeJS.Timeout | null;
}

interface ThrottleOptions {
  concurrent: number;
  gapMs: number;
  maxWaiting: number;
}

class Throttle {
  declare options: ThrottleOptions;
  declare lanes: Map<string, Lane>;

  constructor(options: ThrottleOptions) {
    this.options = options;
    this.lanes = new Map();
  }

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await work();
    } finally {
      this.release(key);
    }
  }

  acquire(key: string): Promise<void> {
    const lane = this.lanes.get(key) ?? { active: 0, lastStart: 0, waiting: [], timer: null };
    this.lanes.set(key, lane);
    if (lane.waiting.length >= this.options.maxWaiting) {
      return Promise.reject(
        fail('RATE_LIMITED', 'Too many requests to the data source at once. Wait a moment and try again.')
      );
    }
    return new Promise((resolve) => {
      lane.waiting.push(resolve);
      this.pump(key);
    });
  }

  release(key: string): void {
    const lane = this.lanes.get(key);
    if (!lane) return;
    lane.active = Math.max(0, lane.active - 1);
    this.pump(key);
  }

  pump(key: string): void {
    const lane = this.lanes.get(key);
    if (!lane || lane.timer) return;
    while (lane.active < this.options.concurrent && lane.waiting.length) {
      const wait = lane.lastStart + this.options.gapMs - Date.now();
      if (wait > 0) {
        lane.timer = setTimeout(() => {
          lane.timer = null;
          this.pump(key);
        }, wait);
        return;
      }
      lane.active += 1;
      lane.lastStart = Date.now();
      lane.waiting.shift()!();
    }
  }
}

export { Throttle };
export type { ThrottleOptions };
