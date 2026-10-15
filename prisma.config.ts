import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function databaseUrl(): string {
  const url = new URL('postgresql://localhost');
  url.hostname = process.env.DB_HOST || 'localhost';
  url.port = process.env.DB_PORT || '5432';
  url.username = encodeURIComponent(process.env.DB_USER || '');
  url.password = encodeURIComponent(process.env.DB_PASSWORD || '');
  url.pathname = `/${encodeURIComponent(process.env.DB_NAME || '')}`;
  if (process.env.DB_SSL === 'true') {
    url.searchParams.set('sslmode', 'require');
    if (process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false') url.searchParams.set('sslaccept', 'accept_invalid_certs');
  }
  return url.toString();
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseUrl() },
});
