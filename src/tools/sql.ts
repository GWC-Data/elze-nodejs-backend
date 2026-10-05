function quoteIdentifier(name: unknown): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function quoteQualified(schema: unknown, table: unknown): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function escapeLiteral(value: unknown): string {
  return String(value).replace(/'/g, "''");
}

export { quoteIdentifier, quoteQualified, escapeLiteral };
