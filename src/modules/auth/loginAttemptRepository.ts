import config from '../../config';
import { Prisma } from '../../generated/prisma/client';

const { prisma } = config.database;

async function lockedUntil(key: string): Promise<Date | null> {
  const row = await prisma.loginAttempt.findUnique({ where: { identifier: key }, select: { lockedUntil: true } });
  return row ? row.lockedUntil : null;
}

async function recordFailure(
  key: string,
  { windowSeconds, maxAttempts, lockoutSeconds }: { windowSeconds: number; maxAttempts: number; lockoutSeconds: number }
): Promise<void> {
  const windowElapsed = Prisma.sql`login_attempts.window_started_at < now() - (${windowSeconds} * interval '1 second')`;
  const nextAttempts = Prisma.sql`CASE WHEN ${windowElapsed} THEN 1 ELSE login_attempts.attempts + 1 END`;

  await prisma.$executeRaw`
    INSERT INTO login_attempts (identifier, attempts, window_started_at)
    VALUES (${key}, 1, now())
    ON CONFLICT (identifier) DO UPDATE SET
      attempts = ${nextAttempts},
      window_started_at = CASE WHEN ${windowElapsed} THEN now()
                               ELSE login_attempts.window_started_at END,
      locked_until = CASE WHEN (${nextAttempts}) >= ${maxAttempts}
                          THEN now() + (${lockoutSeconds} * interval '1 second')
                          ELSE login_attempts.locked_until END`;
}

async function clear(key: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { identifier: key } });
}

async function prune(): Promise<number> {
  return prisma.$executeRaw`
    DELETE FROM login_attempts
     WHERE (locked_until IS NULL OR locked_until < now())
       AND window_started_at < now() - interval '1 day'`;
}

export { lockedUntil, recordFailure, clear, prune };
