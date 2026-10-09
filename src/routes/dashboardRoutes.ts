import express from 'express';
import { authenticated, requirePermission, requireDashboardAccess } from '../middleware/authMiddleware';
import * as dashboard from '../controllers/dashboardController';

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
router.delete('/:dashboardId', requirePermission('dashboard.delete'), requireDashboardAccess('admin'), dashboard.remove);

export = router;
