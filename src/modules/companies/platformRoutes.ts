import express from 'express';
import { authenticated, requirePlatform, requirePermission } from '../auth/authMiddleware';
import * as platform from './platformController';
import companyRoutes from './companyRoutes';
import userRoutes from '../users/userRoutes';
import roleRoutes from '../roles/roleRoutes';

const router = express.Router();

router.use(...authenticated, requirePlatform);

router.get('/overview', requirePermission('company.read'), platform.overview);
router.get('/settings', platform.settings);
router.get('/features', requirePermission('company.read'), platform.features);

router.use('/companies', companyRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);

export = router;
