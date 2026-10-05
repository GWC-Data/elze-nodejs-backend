import nodemailer from 'nodemailer';
import config from '../../config';

const { smtp } = config.email;

const transporter = nodemailer.createTransport({
  host: smtp.host,
  port: smtp.port,
  secure: smtp.secure,
  auth: smtp.user ? { user: smtp.user, pass: smtp.password! } : undefined,
});

interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function send({ from, to, subject, text, html }: OutgoingMail) {
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return { id: info.messageId, detail: info.response };
}

async function verify(): Promise<void> {
  await transporter.verify();
}

export { send, verify };
export type { OutgoingMail };
