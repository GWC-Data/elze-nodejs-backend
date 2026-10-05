import './env';
import { required, optional, integer, boolean, ConfigError } from './configError';

const SMTP_HOST = required(
  'SMTP_HOST',
  'the mail relay that sends onboarding and activation email, e.g. smtp.gmail.com'
);
const SMTP_PORT = integer('SMTP_PORT', 587, { min: 1, max: 65535 });

const SMTP_SECURE = boolean('SMTP_SECURE', SMTP_PORT === 465);

const SMTP_USERNAME = optional('SMTP_USERNAME', null);
const SMTP_PASSWORD = optional('SMTP_PASSWORD', null);

if (Boolean(SMTP_USERNAME) !== Boolean(SMTP_PASSWORD)) {
  throw new ConfigError(
    'SMTP_USERNAME and SMTP_PASSWORD must be set together, or both left blank for an ' +
    'unauthenticated relay.'
  );
}

const EMAIL_FROM = optional('EMAIL_FROM', null) || SMTP_USERNAME;

if (!EMAIL_FROM) {
  throw new ConfigError(
    'No From address: set EMAIL_FROM, or SMTP_USERNAME for it to default to.'
  );
}

const SUPPORT_EMAIL = optional('SUPPORT_EMAIL', null);

const smtp = {
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  user: SMTP_USERNAME,
  password: SMTP_PASSWORD,
};

export { EMAIL_FROM, SUPPORT_EMAIL, smtp };
