import express from 'express';
import { authenticated } from '../middleware/auth.middleware';
import * as audit from '../controllers/audit.controller';

const router = express.Router();

// Every signed-in account may read the trail; audit.service decides how much of it.
router.use(...authenticated);

router.get('/', audit.list);

export = router;
