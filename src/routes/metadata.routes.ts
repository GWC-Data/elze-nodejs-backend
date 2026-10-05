import express from 'express';
import { authenticated, requirePermission, requireDashboardAccess } from '../middleware/auth.middleware';
import * as metadata from '../controllers/metadata.controller';

const router = express.Router();

router.use(...authenticated);

router.get('/columns', requirePermission('data.read'), requireDashboardAccess('view'), metadata.columns);
router.post('/preview', requirePermission('dashboard.update'), requireDashboardAccess('developer'), metadata.preview);

export = router;
