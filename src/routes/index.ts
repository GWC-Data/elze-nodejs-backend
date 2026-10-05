import express from 'express';
import { requestTimer } from '../middleware/requestTimer.middleware';
import { notFound, errorHandler } from '../middleware/error.middleware';
import { health } from '../controllers/health.controller';
import authRoutes from './auth.routes';
import platformRoutes from './platform.routes';
import workspaceRoutes from './workspace.routes';
import userRoutes from './user.routes';
import groupRoutes from './group.routes';
import accessRoutes from './access.routes';
import contextRoutes from './context.routes';
import metadataRoutes from './metadata.routes';
import dashboardRoutes from './dashboard.routes';
import auditRoutes from './audit.routes';
import companyRoleRoutes from './companyRole.routes';
import gateRoutes from './gate.routes';

const router = express.Router();

router.use(requestTimer);

router.get('/health', health);

router.use('/auth', authRoutes);
router.use('/platform', platformRoutes);

router.use('/workspace', workspaceRoutes);
router.use('/users', userRoutes);
router.use('/groups', groupRoutes);
router.use('/access', accessRoutes);
router.use('/audit', auditRoutes);
router.use('/roles', companyRoleRoutes);
router.use('/gate', gateRoutes);

router.use('/context', contextRoutes);

router.use('/dashboard', metadataRoutes);
router.use('/dashboard', dashboardRoutes);

router.use(notFound);
router.use(errorHandler);

export = router;
