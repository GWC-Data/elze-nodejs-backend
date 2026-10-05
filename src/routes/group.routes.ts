import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as group from '../controllers/group.controller';

const router = express.Router();

router.use(...authenticated);

router.get('/', requirePermission('group.read'), group.list);
router.post('/', requirePermission('group.create'), group.create);
router.get('/:id', requirePermission('group.read'), group.get);
router.put('/:id', requirePermission('group.update'), group.update);
router.delete('/:id', requirePermission('group.delete'), group.remove);
router.get('/:id/members', requirePermission('group.read'), group.members);

export = router;
