import { fail } from '../tools/AppError';
import { accessLevelKeyOf } from '../constants/accessLevels';
import type { AccessResource } from '../constants/accessLevels';

function requireLevelId(value: unknown, resource: AccessResource = 'dashboard'): string {
  const key = accessLevelKeyOf(resource, typeof value === 'string' ? value.trim().toLowerCase() : value);
  if (!key) throw fail('VALIDATION_ERROR', `levelId must be the id of a ${resource} access level.`);
  return key;
}

export { requireLevelId };
