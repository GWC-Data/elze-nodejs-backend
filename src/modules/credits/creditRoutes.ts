import express from 'express';
import { authenticated, requirePermission, requirePlatform } from '../auth/authMiddleware';
import * as credit from './creditController';

const router = express.Router();

router.use(...authenticated);

router.get('/me', credit.me);
router.get('/rates', credit.rates);
router.post('/refunds', credit.refund);

router.put('/rates/:action', requirePlatform, requirePermission('credits.allocate'), credit.updateRate);
router.get('/companies', requirePlatform, requirePermission('credits.allocate'), credit.companies);
router.post(
  '/companies/:companyId/allocations',
  requirePlatform,
  requirePermission('credits.allocate'),
  credit.allocate
);

router.get('/overview', requirePermission('credits.manage'), credit.overview);
router.get('/members', requirePermission('credits.manage'), credit.members);
router.put('/members/:userId/limit', requirePermission('credits.manage'), credit.setLimit);
router.get('/activity', requirePermission('credits.manage'), credit.activity);

export = router;
