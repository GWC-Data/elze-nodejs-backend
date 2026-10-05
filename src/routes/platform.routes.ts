import express from 'express';
import { authenticated, requirePlatform, requirePermission } from '../middleware/auth.middleware';
import * as platform from '../controllers/platform.controller';
import companyRoutes from './company.routes';
import userRoutes from './user.routes';
import roleRoutes from './role.routes';

const router = express.Router();

router.use(...authenticated, requirePlatform);

router.get('/overview', requirePermission('company.read'), platform.overview);
router.get('/settings', platform.settings);
router.get('/features', requirePermission('company.read'), platform.features);

router.use('/companies', companyRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);

export = router;
