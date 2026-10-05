import crypto from 'crypto';
import config from '../config';

const { credentialSecret } = config.context;

const CREDENTIAL_SECRET = credentialSecret();

const KEY = crypto.createHash('sha256').update(CREDENTIAL_SECRET, 'utf8').digest();

const VERSION = 'v1';
const IV_BYTES = 12;

function seal(plaintext: unknown): string {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('seal() requires a non-empty string');
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

function open(sealed: unknown): string {
  if (typeof sealed !== 'string') throw new Error('open() requires a string');

  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Stored credential is not in the expected format');
  }

  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    KEY,
    Buffer.from(ivB64, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function hint(plaintext: unknown): string {
  const value = String(plaintext || '');
  return value.length <= 4 ? '****' : `••••${value.slice(-4)}`;
}

export { seal, open, hint };
