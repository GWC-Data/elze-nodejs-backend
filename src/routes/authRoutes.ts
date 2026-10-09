import express from 'express';
import { requireRbac, requireAuth } from '../middleware/authMiddleware';
import { requireCsrf } from '../middleware/csrfMiddleware';
import * as auth from '../controllers/authController';

const router = express.Router();

router.use(requireRbac);

router.post('/login', auth.login);
router.post('/refresh', requireCsrf, auth.refresh);
router.post('/logout', requireCsrf, auth.logout);
router.get('/me', requireAuth, auth.me);
router.get('/sessions', requireAuth, auth.sessions);
router.post('/change-password', requireAuth, auth.changePassword);
router.get('/activation', auth.describeActivation);
router.post('/activation', auth.activate);

export = router;
