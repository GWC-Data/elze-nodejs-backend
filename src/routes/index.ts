import express from 'express';
import { requestTimer } from '../middleware/requestTimerMiddleware';
import { notFound, errorHandler } from '../middleware/errorMiddleware';
import { health } from '../controllers/healthController';
import authRoutes from './authRoutes';
import platformRoutes from './platformRoutes';
import workspaceRoutes from './workspaceRoutes';
import userRoutes from './userRoutes';
import groupRoutes from './groupRoutes';
import accessRoutes from './accessRoutes';
import contextRoutes from './contextRoutes';
import metadataRoutes from './metadataRoutes';
import dashboardRoutes from './dashboardRoutes';
import auditRoutes from './auditRoutes';
import companyRoleRoutes from './companyRoleRoutes';
import gateRoutes from './gateRoutes';

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
