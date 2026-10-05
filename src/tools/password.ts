import bcrypt from 'bcryptjs';
import config from '../config';

const { BCRYPT_ROUNDS } = config.auth;

const DUMMY_HASH = bcrypt.hashSync('password-that-is-never-valid', BCRYPT_ROUNDS);

function hashPassword(password: unknown): string {
  return bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
}

function verifyPassword(password: unknown, hash: unknown): boolean {
  return bcrypt.compareSync(String(password || ''), String(hash || DUMMY_HASH));
}

export { hashPassword, verifyPassword };
