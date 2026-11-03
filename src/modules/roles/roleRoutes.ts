import express from 'express';
import { authenticated, requirePermission } from '../auth/authMiddleware';
import * as role from './roleController';

const router = express.Router();

router.use(...authenticated);

router.get('/permissions', requirePermission('role.read'), role.permissions);
router.get('/', requirePermission('role.read'), role.list);
router.get('/assignable', requirePermission('user.create'), role.assignable);
router.get('/:id/permissions', requirePermission('role.read'), role.rolePermissions);
router.put('/:id/permissions', requirePermission('role.update'), role.replacePermissions);

export = router;
