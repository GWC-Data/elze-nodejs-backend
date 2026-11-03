function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function adapterCause(err: unknown): unknown {
  return field(field(field(err, 'meta'), 'driverAdapterError'), 'cause');
}

function textOrUndefined(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function sqlState(err: unknown): string | undefined {
  const original = textOrUndefined(field(adapterCause(err), 'originalCode'));
  if (original !== undefined) return original;
  const code = field(err, 'code');
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function dbMessage(err: unknown): string {
  return textOrUndefined(field(adapterCause(err), 'originalMessage') ?? field(err, 'message')) ?? String(err);
}

function constraintOf(err: unknown): string | undefined {
  return textOrUndefined(field(field(adapterCause(err), 'constraint'), 'index') ?? field(err, 'constraint'));
}

export { sqlState, dbMessage, constraintOf };
