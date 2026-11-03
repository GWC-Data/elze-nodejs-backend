import express from 'express';
import { authenticated, requirePermission, requireDashboardAccess } from '../auth/authMiddleware';
import * as metadata from './metadataController';

const router = express.Router();

router.use(...authenticated);

router.get('/columns', requirePermission('data.read'), requireDashboardAccess('view'), metadata.columns);
router.post('/preview', requirePermission('dashboard.update'), requireDashboardAccess('developer'), metadata.preview);

export = router;
