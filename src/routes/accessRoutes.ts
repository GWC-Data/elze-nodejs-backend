import express from 'express';
import { authenticated, requirePermission } from '../middleware/authMiddleware';
import * as access from '../controllers/accessController';

const router = express.Router();

router.use(...authenticated);

router.get('/levels', requirePermission('access.read'), access.levels);
router.get('/dashboards', access.dashboards);
router.get('/dashboards/grantable', requirePermission('access.grant'), access.grantable);
router.get('/dashboards/:dashboardId/grants', access.grants);
router.get('/dashboards/:dashboardId/people', access.people);
router.put('/dashboards/:dashboardId/users/:userId', access.grantUser);
router.delete('/dashboards/:dashboardId/users/:userId', access.revokeUser);
router.put('/dashboards/:dashboardId/groups/:groupId', requirePermission('access.grant'), access.grantGroup);
router.delete('/dashboards/:dashboardId/groups/:groupId', requirePermission('access.revoke'), access.revokeGroup);
router.get('/groups/:groupId/dashboards', requirePermission('access.read'), access.groupDashboards);

export = router;
