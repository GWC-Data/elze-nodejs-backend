import express from 'express';
import { authenticated, requirePermission } from '../middleware/authMiddleware';
import * as role from '../controllers/roleController';

const router = express.Router();

router.use(...authenticated);

router.get('/permissions', requirePermission('role.read'), role.permissions);
router.get('/', requirePermission('role.read'), role.list);
router.get('/:name/permissions', requirePermission('role.read'), role.rolePermissions);
router.put('/:name/permissions', requirePermission('role.update'), role.replacePermissions);

export = router;
