import { fail } from '../errors/AppError';

function requireString(
  value: unknown,
  label: string,
  { max = 255, min = 1 }: { max?: number; min?: number } = {}
): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) throw fail('VALIDATION_ERROR', `${label} is required`);
  if (text.length > max) throw fail('VALIDATION_ERROR', `${label} must be ${max} characters or fewer`);
  return text;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value.trim());
}

function requireUuid(value: unknown, label = 'id'): string {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(id)) throw fail('VALIDATION_ERROR', `${label} must be a UUID`);
  return id;
}

function optionalFlag(value: unknown, label: string): boolean {
  if (value === undefined || value === null || value === '') return false;
  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  throw fail('VALIDATION_ERROR', `${label} must be true or false`);
}

function requireArray(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw fail('VALIDATION_ERROR', message);
  return value;
}

function bodyOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export { requireUuid, isUuid, requireString, requireArray, optionalFlag, bodyOf };
