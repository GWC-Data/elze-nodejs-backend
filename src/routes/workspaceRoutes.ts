import express from 'express';
import { authenticated, requirePermission } from '../middleware/authMiddleware';
import * as workspace from '../controllers/workspaceController';

const router = express.Router();

router.use(...authenticated);

router.get('/company', requirePermission('company.read'), workspace.company);
router.get('/overview', workspace.overview);

export = router;
