import config from '../config';
import { fail } from '../tools/AppError';
import * as provider from './providers/smtpProvider';

const { EMAIL_FROM } = config.email;

interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendEmail(message: EmailMessage, { consequence }: { consequence?: string } = {}) {
  const { to, subject, text, html } = message;
  if (!to || !subject || !text) {
    throw new Error('sendEmail requires at least { to, subject, text }');
  }

  try {
    const result = await provider.send({ from: EMAIL_FROM!, to, subject, text, html });
    console.log(`[email] sent "${subject}" to ${to}${result && result.detail ? ` (${result.detail})` : ''}`);
    return result;
  } catch (err: any) {
    console.error(`[email] delivery to ${to} failed: ${err.message}`);
    throw fail(
      'EMAIL_DELIVERY_FAILED',
      [
        `The email to ${to} could not be sent.`,
        consequence,
        'Check the mail configuration and try again.',
      ].filter(Boolean).join(' ')
    );
  }
}

function describeTransport() {
  return { provider: 'smtp', from: EMAIL_FROM };
}

function verifyTransport(): Promise<void> {
  return provider.verify();
}

export { sendEmail, describeTransport, verifyTransport };
export type { EmailMessage };
