import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticated } from '../middleware/authMiddleware';
import { checkAgentRequest } from '../services/agentGateService';
import { denied } from '../services/auditService';
import { ERROR_STATUS } from '../constants/errorCodes';

const router = express.Router();

router.get('/agents', ...authenticated, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await checkAgentRequest(req.actor, req.get('x-original-uri'), req.get('x-original-method'));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

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
