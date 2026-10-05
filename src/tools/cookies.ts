import crypto from 'crypto';
import type { Request, Response, CookieOptions } from 'express';
import config from '../config';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  CSRF_COOKIE,
  ACCESS_PATH,
  LEGACY_ACCESS_PATH,
  REFRESH_PATH,
} from '../constants/session';

const { COOKIE_SECURE, COOKIE_SAMESITE, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } = config.auth;

// TODO(types): COOKIE_SAMESITE is a free-form env string; passed through to Express as-is.
const SAME_SITE = COOKIE_SAMESITE as CookieOptions['sameSite'];

function baseCookie(path: string, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
    path,
    maxAge: maxAgeSeconds * 1000,
  };
}

function setSessionCookies(res: Response, { accessToken, refreshToken }: { accessToken: string; refreshToken: string }) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');

  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(LEGACY_ACCESS_PATH, 0), maxAge: undefined });
  res.cookie(ACCESS_COOKIE, accessToken, baseCookie(ACCESS_PATH, ACCESS_TOKEN_TTL_SECONDS));
  res.cookie(REFRESH_COOKIE, refreshToken, baseCookie(REFRESH_PATH, REFRESH_TOKEN_TTL_SECONDS));
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(ACCESS_PATH, 0), maxAge: undefined });
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie(LEGACY_ACCESS_PATH, 0), maxAge: undefined });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(REFRESH_PATH, 0), maxAge: undefined });
  res.clearCookie(CSRF_COOKIE, {
    httpOnly: false,
    secure: COOKIE_SECURE,
    sameSite: SAME_SITE,
    path: '/',
  });
}

function readCookie(req: Request, name: string): string | null {
  return (req.cookies && req.cookies[name]) || null;
}

const readAccessCookie = (req: Request) => readCookie(req, ACCESS_COOKIE);
const readRefreshCookie = (req: Request) => readCookie(req, REFRESH_COOKIE);
const readCsrfCookie = (req: Request): string | undefined => req.cookies && req.cookies[CSRF_COOKIE];

export { setSessionCookies, clearSessionCookies, readAccessCookie, readRefreshCookie, readCsrfCookie };
