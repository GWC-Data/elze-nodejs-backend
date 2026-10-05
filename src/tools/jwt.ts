import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from 'jsonwebtoken';
import config from '../config';
import { fail } from './AppError';

const { JWT_ACCESS_SECRET, ACCESS_TOKEN_TTL_SECONDS } = config.auth;

const ACCESS_TOKEN_TYPE = 'access';

interface AccessTokenUser {
  id: number | string;
  company_id?: number | null;
  role: string;
}

function signAccessToken(user: AccessTokenUser, familyId: string): string {
  return jwt.sign(
    {
      sub: String(user.id),
      cid: user.company_id ?? null,
      rol: user.role,
      fam: familyId,
      typ: ACCESS_TOKEN_TYPE,
      jti: crypto.randomUUID(),
    },
    JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS }
  );
}

function verifyAccessToken(token: string): JwtPayload {
  let payload;
  try {
    // TODO(types): tokens are always signed with an object payload, never a bare string.
    payload = jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      throw fail('TOKEN_EXPIRED', 'Your session has expired.');
    }
    throw fail('UNAUTHENTICATED', 'Your session is not valid.');
  }
  if (payload.typ !== ACCESS_TOKEN_TYPE) {
    throw fail('UNAUTHENTICATED', 'Your session is not valid.');
  }
  return payload;
}

export { signAccessToken, verifyAccessToken };
export type { AccessTokenUser };
