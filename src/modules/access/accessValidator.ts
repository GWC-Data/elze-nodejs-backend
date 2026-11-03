import { fail } from '../../shared/errors/AppError';
import { accessLevelKeyOf } from '../catalogue/catalogueService';
import type { AccessResource } from '../catalogue/catalogueService';

function requireLevelId(value: unknown, resource: AccessResource = 'dashboard'): string {
  const key = accessLevelKeyOf(resource, typeof value === 'string' ? value.trim().toLowerCase() : value);
  if (!key) throw fail('VALIDATION_ERROR', `levelId must be the id of a ${resource} access level.`);
  return key;
}

export { requireLevelId };
