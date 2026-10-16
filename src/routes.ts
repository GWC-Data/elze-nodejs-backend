import express from 'express';
import config from './config';
import { requestTimer } from './shared/http/requestTimerMiddleware';
import { notFound, errorHandler } from './shared/http/errorMiddleware';
import { health } from './modules/system/healthController';
import authRoutes from './modules/auth/authRoutes';
import platformRoutes from './modules/companies/platformRoutes';
import workspaceRoutes from './modules/companies/workspaceRoutes';
import userRoutes from './modules/users/userRoutes';
import groupRoutes from './modules/groups/groupRoutes';
import accessRoutes from './modules/access/accessRoutes';
import contextRoutes from './modules/contextLayer/contextRoutes';
import metadataRoutes from './modules/dashboards/metadataRoutes';
import dashboardRoutes from './modules/dashboards/dashboardRoutes';
import auditRoutes from './modules/audit/auditRoutes';
import companyRoleRoutes from './modules/roles/companyRoleRoutes';
import gateRoutes from './modules/contextLayer/gateRoutes';
import docsRoutes from './modules/system/docsRoutes';

const { IS_PRODUCTION } = config.env;

const router = express.Router();

router.use(requestTimer);

router.get('/health', health);

if (!IS_PRODUCTION) router.use('/docs', docsRoutes);

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
