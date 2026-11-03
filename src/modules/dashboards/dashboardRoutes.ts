import express from 'express';
import type { RequestHandler } from 'express';
import { authenticated, requirePermission, requireDashboardAccess } from '../auth/authMiddleware';
import { optionalFlag } from '../../shared/validation/commonValidator';
import * as dashboard from './dashboardController';

function unlessPermanent(guard: RequestHandler): RequestHandler {
  return (req, res, next) => (optionalFlag(req.query.permanent, 'permanent') ? next() : guard(req, res, next));
}

const router = express.Router();

router.use(...authenticated);

router.post('/', requirePermission('dashboard.create'), dashboard.create);
router.get('/:dashboardId', requirePermission('dashboard.read'), requireDashboardAccess('view'), dashboard.view);
router.patch(
  '/:dashboardId/config',
  requirePermission('dashboard.update'),
  requireDashboardAccess('developer'),
  dashboard.updateCard
);
router.delete(
  '/:dashboardId',
  requirePermission('dashboard.delete'),
  unlessPermanent(requireDashboardAccess('admin')),
  dashboard.remove
);

export = router;
