import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticated } from '../auth/authMiddleware';
import { checkAgentRequest } from './agentGateService';
import { chargeAgentRequest } from '../credits/creditService';
import { denied } from '../audit/auditService';
import { ERROR_STATUS } from '../../shared/errors/errorCodes';
import { entry, strictEntry } from './contextTypes';

const CREDIT_CHARGE_HEADER = 'X-Credit-Charge';
const CREDIT_REFUSALS = new Set(['INSUFFICIENT_CREDITS', 'CREDIT_LIMIT_REACHED']);

const router = express.Router();

router.get('/agents', ...authenticated, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const request = await checkAgentRequest(req.actor, req.get('x-original-uri'), req.get('x-original-method'));
    const charge = request ? await chargeAgentRequest(req.actor, request) : null;
    if (charge) res.set(CREDIT_CHARGE_HEADER, charge);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  void next;
  const code = entry(err, 'code');
  const status = ERROR_STATUS[String(code)] === 401 ? 401 : 403;
  if (req.actor && status === 403 && !CREDIT_REFUSALS.has(String(code))) {
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
