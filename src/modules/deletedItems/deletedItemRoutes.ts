import express from 'express';
import { authenticated, requirePermission } from '../auth/authMiddleware';
import * as deletedItem from './deletedItemController';

const router = express.Router();

router.use(...authenticated, requirePermission('delete.permanent'));

router.get('/', deletedItem.list);
router.post('/:type/:id/restore', deletedItem.restore);
router.delete('/:type/:id', deletedItem.purge);

export = router;
