import { fail } from '../tools/AppError';
import { ACCESS_LEVELS } from '../constants/permissions';

function requireLevel(level: string): string {
  if (!ACCESS_LEVELS.includes(level)) {
    throw fail('VALIDATION_ERROR', `Access level must be one of: ${ACCESS_LEVELS.join(', ')}`);
  }
  return level;
}

export { requireLevel };
