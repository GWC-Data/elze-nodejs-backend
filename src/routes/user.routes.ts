import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as user from '../controllers/user.controller';

const router = express.Router();

router.use(...authenticated);

router.get('/options', requirePermission('user.read'), user.options);
router.get('/scope-options', requirePermission('scope.read'), user.scopeOptions);
router.get('/', requirePermission('user.read'), user.list);
router.post('/', requirePermission('user.create'), user.create);
router.get('/:id', requirePermission('user.read'), user.get);
router.patch('/:id', requirePermission('user.update'), user.update);
router.post('/:id/deactivate', requirePermission('user.deactivate'), user.deactivate);
router.post('/:id/activate', requirePermission('user.activate'), user.activate);
router.post('/:id/activation', requirePermission('user.update'), user.reissueActivation);
router.delete('/:id', requirePermission('user.delete'), user.remove);
router.get('/:id/access', requirePermission('access.read'), user.access);
router.get('/:id/scope', requirePermission('scope.read'), user.getScope);
router.put('/:id/scope', requirePermission('scope.update'), user.replaceScope);

export = router;
