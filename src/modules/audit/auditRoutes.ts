import express from 'express';
import { authenticated } from '../auth/authMiddleware';
import * as audit from './auditController';

const router = express.Router();

router.use(...authenticated);

router.get('/', audit.list);

export = router;
