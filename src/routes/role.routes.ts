import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as role from '../controllers/role.controller';

const router = express.Router();

router.use(...authenticated);

router.get('/permissions', requirePermission('role.read'), role.permissions);
router.get('/', requirePermission('role.read'), role.list);
router.get('/:name/permissions', requirePermission('role.read'), role.rolePermissions);
router.put('/:name/permissions', requirePermission('role.update'), role.replacePermissions);

export = router;
