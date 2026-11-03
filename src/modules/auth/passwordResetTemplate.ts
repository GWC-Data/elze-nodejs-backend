import config from '../../config';
import { escapeHtml, hours, supportLine } from '../../shared/email/emailTemplate';
import type { EmailContent } from '../../shared/email/emailTemplate';

const { APPLICATION_URL } = config.auth;

interface PasswordResetInput {
  displayName?: string | null;
  username: string;
  companyName?: string | null;
  resetUrl: string;
  ttlSeconds: number;
}

function passwordReset({ displayName, username, companyName, resetUrl, ttlSeconds }: PasswordResetInput): EmailContent {
  const greeting = displayName ? `Hello ${displayName},` : 'Hello,';
  const where = companyName ? ` for ${companyName}` : '';
  const validFor = hours(ttlSeconds);

  const text = [
    greeting,
    '',
    `Someone asked to reset the password of your account on the analytics workspace${where}.`,
    '',
    'Your account',
    `  Application:  ${APPLICATION_URL}`,
    `  Username:     ${username}`,
    '',
    'Choose a new password',
    `  ${resetUrl}`,
    '',
    `This link works once and expires in ${validFor}. After that, request a new`,
    'one from the sign-in page.',
    '',
    'Security notice',
    '  If you did not ask for this, ignore this email: your password stays as it',
    '  is and the link will expire on its own. Do not forward this email - anyone',
    '  holding the link can set the password on this account.',
    '',
    supportLine,
  ].join('\n');

  const html = `
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.55;color:#1e293b;max-width:560px">
  <p>${escapeHtml(greeting)}</p>
  <p>Someone asked to reset the password of your account on the analytics workspace${escapeHtml(where)}.</p>

  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:2px 16px 2px 0;color:#64748b">Application</td><td><a href="${escapeHtml(APPLICATION_URL)}">${escapeHtml(APPLICATION_URL)}</a></td></tr>
    <tr><td style="padding:2px 16px 2px 0;color:#64748b">Username</td><td><strong>${escapeHtml(username)}</strong></td></tr>
  </table>

  <p style="margin:24px 0">
    <a href="${escapeHtml(resetUrl)}"
       style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">
      Choose a new password
    </a>
  </p>
  <p style="color:#64748b;font-size:13px">
    This link works once and expires in ${escapeHtml(validFor)}. If it stops working, request a new one from the sign-in page.
  </p>

  <h3 style="font-size:14px;margin:24px 0 4px">Security notice</h3>
  <p style="color:#334155;margin:0">
    If you did not ask for this, ignore this email: your password stays as it is and the link will expire on its own.
    Do not forward this email &mdash; anyone holding the link can set the password on this account.
  </p>

  <p style="color:#64748b;font-size:13px;margin-top:24px">${escapeHtml(supportLine)}</p>
</div>`.trim();

  return {
    subject: companyName ? `Reset your ${companyName} password` : 'Reset your analytics password',
    text,
    html,
  };
}

export { passwordReset };
export type { PasswordResetInput };
