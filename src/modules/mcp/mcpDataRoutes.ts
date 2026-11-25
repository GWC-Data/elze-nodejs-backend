import express from 'express';
import { requirePermission, requireRbac } from '../auth/authMiddleware';
import { mcpFailureLimit, mcpTokenLimit } from '../../shared/http/rateLimitMiddleware';
import { requireMcpToken } from './mcpTokenMiddleware';
import * as mcpData from './mcpDataController';

const router = express.Router();

router.use(requireRbac, mcpFailureLimit, requireMcpToken, mcpTokenLimit, requirePermission('context.read'));

router.get('/session', mcpData.session);
router.get('/contexts', mcpData.contexts);
router.get('/contexts/:connectionId/:name', mcpData.overview);
router.get('/contexts/:connectionId/:name/versions', mcpData.versions);
router.get('/contexts/:connectionId/:name/objects', mcpData.objects);
router.get('/contexts/:connectionId/:name/table', mcpData.table);

export = router;
