import crypto from 'crypto';
import config from '../config';

const { JWT_REFRESH_SECRET } = config.auth;

function hashToken(raw: unknown): string {
  return crypto.createHmac('sha256', JWT_REFRESH_SECRET).update(String(raw)).digest('hex');
}

function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export { hashToken, randomToken };
