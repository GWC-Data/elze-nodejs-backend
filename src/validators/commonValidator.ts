import { fail } from '../tools/AppError';

function requireId(value: unknown, label = 'id'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail('VALIDATION_ERROR', `${label} must be a positive integer`);
  }
  return id;
}

function requireString(value: unknown, label: string, { max = 255, min = 1 }: { max?: number; min?: number } = {}): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min) throw fail('VALIDATION_ERROR', `${label} is required`);
  if (text.length > max) throw fail('VALIDATION_ERROR', `${label} must be ${max} characters or fewer`);
  return text;
}

function requireArray(value: unknown, message: string): any[] {
  if (!Array.isArray(value)) throw fail('VALIDATION_ERROR', message);
  return value;
}

export { requireId, requireString, requireArray };
