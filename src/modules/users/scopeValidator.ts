const MAX_SCOPE_VALUE_LENGTH = 120;

function scopeProblem(scopes: unknown, findDimension: (key: string) => unknown): string | null {
  if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) {
    return 'scopes must be an object of dimension -> values[]';
  }
  for (const [key, values] of Object.entries(scopes)) {
    if (!findDimension(key)) return `Unknown scope dimension "${key}"`;
    if (!Array.isArray(values)) return `scopes.${key} must be an array`;
    if (values.some((v) => String(v).length > MAX_SCOPE_VALUE_LENGTH)) {
      return `scopes.${key} contains a value longer than ${MAX_SCOPE_VALUE_LENGTH} characters`;
    }
  }
  return null;
}

export { scopeProblem };
