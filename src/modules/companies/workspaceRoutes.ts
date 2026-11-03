import express from 'express';
import { authenticated, requirePermission } from '../auth/authMiddleware';
import * as workspace from './workspaceController';

const router = express.Router();

router.use(...authenticated);

router.get('/company', requirePermission('company.read'), workspace.company);
router.get('/overview', workspace.overview);

export = router;
