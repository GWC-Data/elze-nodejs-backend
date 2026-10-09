import express from 'express';
import { authenticated } from '../middleware/authMiddleware';
import * as audit from '../controllers/auditController';

const router = express.Router();

router.use(...authenticated);

router.get('/', audit.list);

export = router;
