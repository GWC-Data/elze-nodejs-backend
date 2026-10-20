import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Actor } from '../../shared/types/actor';
import { fail, codeOf } from '../../shared/errors/AppError';
import { readAccessCookie } from '../../shared/security/cookies';
import { verifyAccessToken } from '../../shared/security/jwt';
import { publicUser } from '../users/userSerializer';
import { isRbacReady } from '../system/bootstrapService';
import { findActor } from '../users/userService';
import { buildActor, assertPermission } from './authorizationService';
import { assertDashboardLevel } from '../access/accessService';
import { denied } from '../audit/auditService';
import { requireCsrf } from '../../shared/http/csrfMiddleware';
import { SAFE_METHODS } from '../../shared/security/session';
import { USER_STATUS } from '../../shared/db/statuses';
import { permissionByKey } from '../catalogue/catalogueService';
import { bodyOf } from '../../shared/validation/commonValidator';
import type { PublicUser } from '../users/userSerializer';

function requestPath(req: Request): string {
  return req.originalUrl.split('?')[0];
}

function requireRbac(_req: Request, _res: Response, next: NextFunction): void {
  if (!isRbacReady()) {
    next(fail('SERVICE_UNAVAILABLE', 'The service is starting up or its database is unreachable. Try again shortly.'));
    return;
  }
  next();
}

async function actorFromToken(token: string): Promise<{ actor: Actor; account: PublicUser }> {
  const payload = verifyAccessToken(token);
  const found = await findActor(Number(payload.sub));
  const user = found?.user;

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
  actor.familyId = typeof payload.fam === 'string' ? payload.fam : undefined;
  return { actor, account: publicUser(user) };
}

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.actor) return next();

  const token = readAccessCookie(req);
  if (!token) return next(fail('UNAUTHENTICATED', 'Sign in to continue.'));

  if (!SAFE_METHODS.has(req.method)) {
    let csrfError: unknown = null;
    requireCsrf(req, res, (err?: unknown) => {
      csrfError = err || null;
    });
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

function requirePasswordCurrent(req: Request, _res: Response, next: NextFunction): void {
  if (req.actor?.mustChangePassword) {
    next(fail('PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing.'));
    return;
  }
  next();
}

function requirePlatform(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) {
    next(fail('UNAUTHENTICATED', 'Sign in to continue.'));
    return;
  }
  if (req.actor.isPlatform) {
    next();
    return;
  }

  denied(req.actor, { reason: 'platform_only', method: req.method, path: requestPath(req) });
  next(fail('TENANT_ACCESS_DENIED', 'This area is restricted to platform administrators.'));
}

function requirePermission(permission: string): RequestHandler {
  return function permissionGuard(req: Request, _res: Response, next: NextFunction): void {
    try {
      assertPermission(req.actor, permission);
      next();
    } catch (err) {
      const code = codeOf(err);
      if (req.actor && (code === 'INSUFFICIENT_PERMISSION' || code === 'FEATURE_NOT_ENABLED')) {
        denied(req.actor, {
          permission,
          permissionId: permissionByKey(permission)?.id,
          reason: code,
          method: req.method,
          path: requestPath(req),
        });
      }
      next(err);
    }
  };
}

function requireDashboardAccess(level: string, param = 'dashboardId'): RequestHandler {
  return async function dashboardGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const dashboardId = req.params[param] || bodyOf(req.body).dashboardId || req.query?.dashboardId;
      if (!dashboardId) {
        return next(fail('VALIDATION_ERROR', 'A dashboard id is required.'));
      }
      req.dashboardId = String(dashboardId);
      req.dashboardLevel = await assertDashboardLevel(req.actor, req.dashboardId, level);
      next();
    } catch (err) {
      const code = codeOf(err);
      if (req.actor && (code === 'DASHBOARD_NOT_FOUND' || code === 'INSUFFICIENT_PERMISSION')) {
        denied(req.actor, { dashboardId: req.params[param] || null, requiredLevel: level, reason: code });
      }
      next(err);
    }
  };
}

const authenticated: RequestHandler[] = [requireRbac, requireAuth, requirePasswordCurrent];

export { requireRbac, requireAuth, requirePlatform, requirePermission, requireDashboardAccess, authenticated };
