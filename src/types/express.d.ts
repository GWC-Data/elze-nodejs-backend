import type { Actor } from './actor';

// Fields the auth middleware attaches to the request. `actor` and `account` are declared
// present because every route that reads them sits behind requireAuth; the middleware
// itself still tests `req.actor` before relying on it.
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
