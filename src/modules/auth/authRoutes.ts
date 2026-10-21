import express from 'express';
import { requireRbac, requireAuth } from './authMiddleware';
import { requireCsrf } from '../../shared/http/csrfMiddleware';
import * as auth from './authController';

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
router.post('/forgot-password', auth.forgotPassword);
router.get('/reset-password', auth.describePasswordReset);
router.post('/reset-password', auth.resetPassword);

export = router;
