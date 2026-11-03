import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { setSessionCookies, clearSessionCookies, readRefreshCookie } from '../../shared/security/cookies';
import { bodyOf } from '../../shared/validation/commonValidator';
import * as authService from './authService';
import type { SessionTokens } from '../../shared/security/cookies';

function respondWithSession(res: Response, { cookies, body }: { cookies: SessionTokens; body: unknown }): void {
  setSessionCookies(res, cookies);
  ok(res, body);
}

async function login(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.login(bodyOf(req.body)));
}

async function refresh(req: Request, res: Response): Promise<void> {
  try {
    respondWithSession(res, await authService.refresh(readRefreshCookie(req)));
  } catch (err) {
    if (authService.endsSession(err)) clearSessionCookies(res);
    throw err;
  }
}

async function logout(req: Request, res: Response): Promise<void> {
  const body = await authService.logout(readRefreshCookie(req));
  clearSessionCookies(res);
  ok(res, body);
}

async function me(req: Request, res: Response): Promise<void> {
  ok(res, await authService.me(req.actor, req.account));
}

async function sessions(req: Request, res: Response): Promise<void> {
  ok(res, await authService.sessions(req.actor));
}

async function changePassword(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.changePassword(req.actor, bodyOf(req.body)));
}

async function describeActivation(req: Request, res: Response): Promise<void> {
  ok(res, await authService.describeActivation(req.query.token));
}

async function activate(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.activate(bodyOf(req.body)));
}

async function forgotPassword(req: Request, res: Response): Promise<void> {
  ok(res, await authService.forgotPassword(bodyOf(req.body)));
}

async function describePasswordReset(req: Request, res: Response): Promise<void> {
  ok(res, await authService.describePasswordReset(req.query.token));
}

async function resetPassword(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.resetPassword(bodyOf(req.body)));
}

export {
  login,
  refresh,
  logout,
  me,
  sessions,
  changePassword,
  describeActivation,
  activate,
  forgotPassword,
  describePasswordReset,
  resetPassword,
};
