function quoteIdentifier(name: unknown): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function quoteQualified(schema: unknown, table: unknown): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function escapeLiteral(value: unknown): string {
  return String(value).replace(/'/g, "''");
}

function splitPlaceholders(sql: string): string[] {
  const pieces: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && next === '*') {
      inBlockComment = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        current += ch + next;
        i++;
        continue;
      }
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      if (inDouble && next === '"') {
        current += ch + next;
        i++;
        continue;
      }
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === '?' && !inSingle && !inDouble) {
      pieces.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  pieces.push(current);
  return pieces;
}

export { quoteIdentifier, quoteQualified, escapeLiteral, splitPlaceholders };
