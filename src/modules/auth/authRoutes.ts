import express from 'express';
import { requireRbac, requireAuth } from './authMiddleware';
import { requireCsrf } from '../../shared/http/csrfMiddleware';
import { authLimit } from '../../shared/http/rateLimitMiddleware';
import * as auth from './authController';

const router = express.Router();

router.use(requireRbac);

router.post('/login', authLimit, auth.login);
router.post('/refresh', requireCsrf, auth.refresh);
router.post('/logout', requireCsrf, auth.logout);
router.get('/me', requireAuth, auth.me);
router.get('/sessions', requireAuth, auth.sessions);
router.post('/change-password', requireAuth, auth.changePassword);
router.get('/activation', auth.describeActivation);
router.post('/activation', authLimit, auth.activate);
router.post('/forgot-password', authLimit, auth.forgotPassword);
router.get('/reset-password', auth.describePasswordReset);
router.post('/reset-password', authLimit, auth.resetPassword);

export = router;
