import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticated } from '../auth/authMiddleware';
import { checkAgentRequest } from './agentGateService';
import { denied } from '../audit/auditService';
import { ERROR_STATUS } from '../../shared/errors/errorCodes';
import { entry, strictEntry } from './contextTypes';

const router = express.Router();

router.get('/agents', ...authenticated, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkAgentRequest(req.actor, req.get('x-original-uri'), req.get('x-original-method'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  void next;
  const code = entry(err, 'code');
  const status = ERROR_STATUS[String(code)] === 401 ? 401 : 403;
  if (req.actor && status === 403) {
    denied(req.actor, {
      reason: strictEntry(err, 'code') || 'agent_gate',
      method: req.get('x-original-method') || null,
      path: (req.get('x-original-uri') || '').split('?')[0] || null,
    });
  }
  res
    .status(status)
    .set('X-Gate-Reason', String(code ? code : 'ERROR'))
    .end();
});

export = router;
