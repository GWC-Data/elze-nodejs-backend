import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as company from '../controllers/company.controller';

const router = express.Router();

router.use(...authenticated);

router.get('/', requirePermission('company.read'), company.list);
router.get('/options', requirePermission('company.read'), company.options);
router.post('/', requirePermission('company.create'), company.create);
router.get('/:id', requirePermission('company.read'), company.get);
router.patch('/:id', requirePermission('company.update'), company.update);
router.delete('/:id', requirePermission('company.delete'), company.remove);
router.get('/:id/dashboards', requirePermission('dashboard.assign'), company.dashboards);
router.put('/:id/dashboards/:dashboardId', requirePermission('dashboard.assign'), company.assignDashboard);
router.delete('/:id/dashboards/:dashboardId', requirePermission('dashboard.assign'), company.unassignDashboard);
router.get('/:id/features', requirePermission('company.read'), company.features);
router.put('/:id/features', requirePermission('company.features'), company.replaceFeatures);

export = router;
