import config from '../../config';

const { SUPPORT_EMAIL } = config.email;

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hours(seconds: number): string {
  const h = Math.round(seconds / 3600);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

const supportLine = SUPPORT_EMAIL
  ? `If you need help, contact ${SUPPORT_EMAIL}.`
  : 'If you need help, contact whoever administers this workspace.';

export { escapeHtml, hours, supportLine };
export type { EmailContent };
