import { fail } from '../tools/AppError';

function requireId(value: unknown, label = 'id'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail('VALIDATION_ERROR', `${label} must be a positive integer`);
  }
  return id;
}

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

function requireUuid(value: unknown, label = 'id'): string {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!UUID_PATTERN.test(id)) throw fail('VALIDATION_ERROR', `${label} must be a UUID`);
  return id;
}

function requireArray(value: unknown, message: string): any[] {
  if (!Array.isArray(value)) throw fail('VALIDATION_ERROR', message);
  return value;
}

export { requireId, requireUuid, requireString, requireArray };
