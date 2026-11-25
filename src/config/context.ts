import './env';
import { required, optional, ConfigError } from './configError';

const MIN_SECRET_LENGTH = 32;

function credentialSecret(): string {
  const value = required(
    'CREDENTIAL_SECRET',
    'the key that encrypts stored warehouse credentials. Generate with: ' +
      "node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
  );
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(
      `CREDENTIAL_SECRET must be at least ${MIN_SECRET_LENGTH} characters. ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\""
    );
  }
  return value;
}

function mcpServer(): { url: string | null } {
  const url = optional('CONTEXT_MCP_SERVER_URL', '').trim().replace(/\/+$/, '') || null;
  if (url && !/^https?:\/\//i.test(url)) {
    throw new ConfigError(`CONTEXT_MCP_SERVER_URL must be an http(s) URL (got "${url}")`);
  }
  return { url };
}

export { credentialSecret, mcpServer };
