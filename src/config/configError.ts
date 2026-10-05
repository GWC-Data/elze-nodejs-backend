class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function required(name: string, purpose: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConfigError(`${name} is not set. It is required: ${purpose}`);
  }
  return value.trim();
}

function optional<T>(name: string, fallback: T): string | T {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integer(name: string, fallback: number, { min, max }: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new ConfigError(`${name} must be an integer (got "${raw}")`);
  if (min !== undefined && value < min) throw new ConfigError(`${name} must be at least ${min}`);
  if (max !== undefined && value > max) throw new ConfigError(`${name} must be at most ${max}`);
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new ConfigError(`${name} must be a boolean (true/false), got "${raw}"`);
}

export { ConfigError, required, optional, integer, boolean };
