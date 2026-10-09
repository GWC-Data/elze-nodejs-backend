import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Actor } from '../types/actor';
import { fail } from '../tools/AppError';
import { readAccessCookie } from '../tools/cookies';
import { verifyAccessToken } from '../tools/jwt';
import { publicUser } from '../views/serializers/userSerializer';
import { isRbacReady } from '../services/bootstrapService';
import { findActor } from '../services/userService';
import { buildActor, assertPermission } from '../services/authorizationService';
import { assertDashboardLevel } from '../services/accessService';
import { denied } from '../services/auditService';
import { requireCsrf } from './csrfMiddleware';
import { SAFE_METHODS } from '../constants/session';
import { USER_STATUS } from '../constants/statuses';

function requestPath(req: Request): string {
  return req.originalUrl.split('?')[0];
}

function requireRbac(req: Request, res: Response, next: NextFunction): void {
  if (!isRbacReady()) {
    return next(fail('SERVICE_UNAVAILABLE', 'The service is starting up or its database is unreachable. Try again shortly.'));
  }
  next();
}

async function actorFromToken(token: string): Promise<{ actor: Actor; account: ReturnType<typeof publicUser> }> {
  const payload = verifyAccessToken(token);
  const found = await findActor(Number(payload.sub));
  const user = found && found.user;

  if (!user) throw fail('UNAUTHENTICATED', 'This account no longer exists.');
  if (user.status === USER_STATUS.DISABLED) throw fail('ACCOUNT_DISABLED', 'This account has been deactivated.');
  if (user.status === USER_STATUS.PENDING) {
    throw fail('ACCOUNT_PENDING_ACTIVATION', 'This account has not been activated yet.');
  }
  if (user.company_id && !user.companyActive) {
    throw fail('COMPANY_DISABLED', 'This company is not currently active.');
  }
  if (payload.rol !== user.role) {
    throw fail('UNAUTHENTICATED', 'Your access has changed. Please sign in again.');
  }

  const actor: Actor = buildActor(user, found.permissions, found.features);
  actor.scopes = found.scopes;
  actor.familyId = payload.fam;
  return { actor, account: publicUser(user) };
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.actor) return next();

  const token = readAccessCookie(req);
  if (!token) return next(fail('UNAUTHENTICATED', 'Sign in to continue.'));

  if (!SAFE_METHODS.has(req.method)) {
    let csrfError: unknown = null;
    requireCsrf(req, res, (err?: unknown) => { csrfError = err || null; });
    if (csrfError) return next(csrfError);
  }

  try {
    const { actor, account } = await actorFromToken(token);
    req.actor = actor;
    req.account = account;
    next();
  } catch (err) {
    next(err);
  }
}

function requirePasswordCurrent(req: Request, res: Response, next: NextFunction): void {
  if (req.actor && req.actor.mustChangePassword) {
    return next(fail('PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing.'));
  }
  next();
}

function requirePlatform(req: Request, res: Response, next: NextFunction): void {
  if (!req.actor) return next(fail('UNAUTHENTICATED', 'Sign in to continue.'));
  if (req.actor.isPlatform) return next();

  denied(req.actor, { reason: 'platform_only', method: req.method, path: requestPath(req) });
  next(fail('TENANT_ACCESS_DENIED', 'This area is restricted to platform administrators.'));
}

function requirePermission(permission: string): RequestHandler {
  return function permissionGuard(req: Request, res: Response, next: NextFunction): void {
    try {
      assertPermission(req.actor, permission);
      next();
    } catch (err: any) {
      if (req.actor && (err.code === 'INSUFFICIENT_PERMISSION' || err.code === 'FEATURE_NOT_ENABLED')) {
        denied(req.actor, { permission, reason: err.code, method: req.method, path: requestPath(req) });
      }
      next(err);
    }
  };
}

function requireDashboardAccess(level: string, param = 'dashboardId'): RequestHandler {
  return async function dashboardGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dashboardId = req.params[param] || req.body?.dashboardId || req.query?.dashboardId;
      if (!dashboardId) {
        return next(fail('VALIDATION_ERROR', 'A dashboard id is required.'));
      }
      req.dashboardId = String(dashboardId);
      req.dashboardLevel = await assertDashboardLevel(req.actor, req.dashboardId, level);
      next();
    } catch (err: any) {
      if (req.actor && (err.code === 'DASHBOARD_NOT_FOUND' || err.code === 'INSUFFICIENT_PERMISSION')) {
        denied(req.actor, { dashboardId: req.params[param] || null, requiredLevel: level, reason: err.code });
      }
      next(err);
    }
  };
}

const authenticated: RequestHandler[] = [requireRbac, requireAuth, requirePasswordCurrent];

export {
  requireRbac,
  requireAuth,
  requirePlatform,
  requirePermission,
  requireDashboardAccess,
  authenticated,
};
