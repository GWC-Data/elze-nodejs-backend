import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import { setSessionCookies, clearSessionCookies, readRefreshCookie } from '../tools/cookies';
import * as authService from '../services/auth.service';

function respondWithSession(res: Response, { cookies, body }: { cookies: any; body: unknown }): void {
  setSessionCookies(res, cookies);
  ok(res, body);
}

async function login(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.login(req.body || {}));
}

async function refresh(req: Request, res: Response): Promise<void> {
  try {
    respondWithSession(res, await authService.refresh(readRefreshCookie(req)));
  } catch (err: any) {
    if (err.endsSession) clearSessionCookies(res);
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
  respondWithSession(res, await authService.changePassword(req.actor, req.body || {}));
}

async function describeActivation(req: Request, res: Response): Promise<void> {
  ok(res, await authService.describeActivation(req.query.token));
}

async function activate(req: Request, res: Response): Promise<void> {
  respondWithSession(res, await authService.activate(req.body || {}));
}

export { login, refresh, logout, me, sessions, changePassword, describeActivation, activate };
