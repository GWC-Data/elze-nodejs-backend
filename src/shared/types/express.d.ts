import type { Actor } from './actor';
import type { PublicUser } from './account';

declare global {
  namespace Express {
    interface Request {
      actor: Actor;
      account: PublicUser;
      dashboardId?: string;
      dashboardLevel?: string | null;
    }
  }
}
