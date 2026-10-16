import config from '../src/config';
const { prisma, withTransaction } = config.database;
import { Prisma } from '../src/generated/prisma/client';
import { rawRows } from '../src/shared/db/baseRepository';
import { bootstrapAppMeta } from '../src/modules/system/bootstrapService';
import { issueActivationToken, activationUrl } from '../src/modules/auth/activationService';
import { revokeAllForUser } from '../src/modules/auth/tokenService';
import { sendEmail } from '../src/shared/email/emailService';
import { accountActivation } from '../src/modules/auth/accountActivationTemplate';
const { ACTIVATION_TOKEN_TTL_SECONDS } = config.auth;

interface Args {
  action: 'list' | 'reset' | 'help';
  username: string | null;
  email: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { action: 'list', username: null, email: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user' || arg === '-u') {
      args.action = 'reset';
      args.username = argv[++i];
    } else if (arg === '--email') {
      args.email = argv[++i];
    } else if (arg === '--list' || arg === '-l') {
      args.action = 'list';
    } else if (arg === '--help' || arg === '-h') {
      args.action = 'help';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `
Send an account a fresh activation link, without needing an API token.

  node scripts/resetAccess.js --list                 list every account
  node scripts/resetAccess.js --user <username>      email them a new link
  node scripts/resetAccess.js --user <username> --email <address>

The link lets them set their own password. This script never sets one, and never
prints the token - it is emailed through the configured SMTP relay.
`;

async function list(): Promise<void> {
  const rows = await rawRows(
    prisma,
    Prisma.sql`SELECT u.id, u.username, u.email, r.name AS role, u.status, c.name AS company
       FROM users u
       LEFT JOIN companies c ON c.id = u.company_id
       LEFT JOIN access_control.user_roles ur ON ur.user_id = u.id
       LEFT JOIN access_control.roles r ON r.id = ur.role_id
      ORDER BY c.name NULLS FIRST, u.username`
  );
  if (!rows.length) {
    console.log(
      'No accounts yet. Start the server once with BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD set.'
    );
    return;
  }
  console.table(rows.map((r) => ({ ...r, company: r.company || '(platform)' })));
}

async function reset({ username, email }: Args): Promise<void> {
  const found = await prisma.user.findUnique({
    where: { username: String(username) },
    include: { company: { select: { name: true } } },
  });
  if (!found) throw new Error(`No account named "${username}"`);
  const user = {
    id: found.id,
    username: found.username,
    email: found.email,
    display_name: found.displayName,
    status: found.status,
    companyName: found.company ? found.company.name : null,
  };
  if (user.status === 'disabled') {
    throw new Error(`"${username}" is deactivated. Reactivate it before sending a link.`);
  }

  const target = email || user.email;

  const { token } = await withTransaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        ...(email ? { email: String(email).trim().toLowerCase() } : {}),
        status: 'pending',
        passwordHash: null,
        mustChangePassword: false,
      },
    });
    await revokeAllForUser(user.id, 'access_reissued_cli', tx);
    return issueActivationToken(user.id, null, tx);
  });

  await sendEmail({
    to: target,
    ...accountActivation({
      displayName: user.display_name,
      username: user.username,
      email: target,
      companyName: user.companyName || null,
      activationUrl: activationUrl(token),
      ttlSeconds: ACTIVATION_TOKEN_TTL_SECONDS,
      invitedBy: null,
    }),
  });

  console.log(`Activation link sent to ${target} for "${user.username}".`);
  console.log('Their previous password no longer works and their sessions have ended.');
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.action === 'help') {
    console.log(USAGE);
    return;
  }

  await bootstrapAppMeta();

  if (args.action === 'reset') await reset(args);
  else await list();
})()
  .then(() => process.exit(0))
  .catch((e: any) => {
    console.error(`ERROR  ${e.message}`);
    process.exit(1);
  });
