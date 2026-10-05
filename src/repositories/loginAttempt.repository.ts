import config from '../config';
import { T } from '../models/rbac.model';

const { db } = config.database;

async function lockedUntil(key: string): Promise<Date | null> {
  const { rows } = await db.query(
    `SELECT locked_until FROM ${T.loginAttempts} WHERE identifier = ?`,
    [key]
  );
  return rows[0] ? rows[0].locked_until : null;
}

async function recordFailure(
  key: string,
  { windowSeconds, maxAttempts, lockoutSeconds }: { windowSeconds: number; maxAttempts: number; lockoutSeconds: number }
): Promise<void> {
  const windowElapsed = `${T.loginAttempts}.window_started_at < now() - (? * interval '1 second')`;
  const nextAttempts = `CASE WHEN ${windowElapsed} THEN 1 ELSE ${T.loginAttempts}.attempts + 1 END`;

  await db.query(
    `INSERT INTO ${T.loginAttempts} (identifier, attempts, window_started_at)
     VALUES (?, 1, now())
     ON CONFLICT (identifier) DO UPDATE SET
       attempts = ${nextAttempts},
       window_started_at = CASE WHEN ${windowElapsed} THEN now()
                                ELSE ${T.loginAttempts}.window_started_at END,
       locked_until = CASE WHEN (${nextAttempts}) >= ?
                           THEN now() + (? * interval '1 second')
                           ELSE ${T.loginAttempts}.locked_until END`,
    [key, windowSeconds, windowSeconds, windowSeconds, maxAttempts, lockoutSeconds]
  );
}

async function clear(key: string): Promise<void> {
  await db.query(`DELETE FROM ${T.loginAttempts} WHERE identifier = ?`, [key]);
}

async function prune(): Promise<number | null> {
  const result = await db.query(
    `DELETE FROM ${T.loginAttempts}
      WHERE (locked_until IS NULL OR locked_until < now())
        AND window_started_at < now() - interval '1 day'`
  );
  return result.rowCount;
}

export { lockedUntil, recordFailure, clear, prune };
