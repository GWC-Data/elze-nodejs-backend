import express from 'express';
import { authenticated, requirePermission } from '../auth/authMiddleware';
import * as mcpToken from './mcpTokenController';

const router = express.Router();

router.use(...authenticated);

router.get('/', mcpToken.list);
router.post('/', requirePermission('context.read'), mcpToken.create);
router.post('/revoke-all', mcpToken.revokeAll);
router.delete('/:id', mcpToken.revoke);

export = router;
