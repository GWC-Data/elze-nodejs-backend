import type { Actor } from './actor';

declare global {
  namespace Express {
    interface Request {
      actor: Actor;
      account: any;
      dashboardId?: string;
      dashboardLevel?: string | null;
    }
  }
}

export {};
