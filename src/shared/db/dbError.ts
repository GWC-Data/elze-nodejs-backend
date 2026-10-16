function sqlState(err: unknown): string | undefined {
  const e = err as any;
  return (
    e?.meta?.driverAdapterError?.cause?.originalCode ??
    (typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined)
  );
}

function dbMessage(err: unknown): string {
  const e = err as any;
  return e?.meta?.driverAdapterError?.cause?.originalMessage ?? e?.message ?? String(err);
}

function constraintOf(err: unknown): string | undefined {
  const e = err as any;
  const cause = e?.meta?.driverAdapterError?.cause;
  return cause?.constraint?.index ?? e?.constraint;
}

export { sqlState, dbMessage, constraintOf };
