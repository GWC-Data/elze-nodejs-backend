import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticated } from '../middleware/auth.middleware';
import { checkAgentRequest } from '../services/agentGate.service';
import { denied } from '../services/audit.service';
import { ERROR_STATUS } from '../constants/errorCodes';

// nginx's `auth_request` target (services/agentGate.service.ts). Called with the ORIGINAL
// request's path and method in X-Original-URI / X-Original-Method; nginx copies the browser's
// cookies onto the subrequest, so the session is read exactly as on any /api call.
//
// The subrequest is always a GET, so requireAuth's CSRF check does not run here; the agent
// calls it guards are protected by the session cookie being SameSite=Strict.
const router = express.Router();

router.get('/agents', ...authenticated, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkAgentRequest(req.actor, req.get('x-original-uri'), req.get('x-original-method'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// auth_request understands exactly three answers: 2xx (allow), 401 and 403 (deny with that
// status). Anything else - a 404 for a foreign workspace, a 503 while starting - would reach
// the browser as a 500, so every failure is folded onto 401 or 403 here. The body is dropped
// by nginx anyway.
router.use((err: any, req: Request, res: Response, next: NextFunction) => {
  void next;
  const status = ERROR_STATUS[err && err.code] === 401 ? 401 : 403;
  if (req.actor && status === 403) {
    denied(req.actor, {
      reason: err.code || 'agent_gate',
      method: req.get('x-original-method') || null,
      path: (req.get('x-original-uri') || '').split('?')[0] || null,
    });
  }
  res.status(status).set('X-Gate-Reason', String(err && err.code ? err.code : 'ERROR')).end();
});

export = router;
