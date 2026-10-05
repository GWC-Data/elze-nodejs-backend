import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as companyRole from '../controllers/companyRole.controller';

// A company's own roles (services/companyRole.service.ts). The built-in roles' permissions
// are edited on the platform side only, under /api/platform/roles.
const router = express.Router();

router.use(...authenticated);

router.get('/permissions', requirePermission('role.read'), companyRole.permissions);
router.get('/', requirePermission('role.read'), companyRole.list);
router.post('/', requirePermission('role.create'), companyRole.create);
// Before '/:id', so "built-in" is never read as a role id.
router.put('/built-in/:name', requirePermission('role.edit'), companyRole.saveBuiltIn);
router.delete('/built-in/:name', requirePermission('role.edit'), companyRole.resetBuiltIn);
router.get('/:id', requirePermission('role.read'), companyRole.get);
router.patch('/:id', requirePermission('role.edit'), companyRole.update);
router.delete('/:id', requirePermission('role.delete'), companyRole.remove);

export = router;
