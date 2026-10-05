import express from 'express';
import { authenticated, requirePermission } from '../middleware/auth.middleware';
import * as context from '../controllers/context.controller';

const router = express.Router();

const read = requirePermission('context.read');
// context.manage was split (constants/permissions.ts REPLACED_PERMISSIONS): starting something
// new, changing a draft, publishing it and deleting are four separate grants now.
const create = requirePermission('context.create');
const update = requirePermission('context.update');
const publish = requirePermission('context.publish');
const remove = requirePermission('context.delete');

router.use(...authenticated);

router.get('/connectors', read, context.connectors);
router.get('/connections', read, context.connections);
router.get('/published-versions', read, context.publishedVersions);
router.get('/published-connections', read, context.publishedConnections);
router.get('/published-contexts', read, context.publishedContexts);
router.get('/connections/:id/mcp', read, context.mcp);
router.post('/connections', create, context.createConnection);
router.get('/connections/:id', read, context.getConnection);
router.get('/connections/:id/context', read, context.contextProfile);
router.put('/connections/:id/context', update, context.saveContextProfile);
router.post('/connections/:id/verify', update, context.verifyConnection);
router.get('/connections/:id/datasets', read, context.datasets);
router.get('/connections/:id/profile', read, context.profile);
router.get('/connections/:id/tables/:tableId', read, context.table);
router.get('/connections/:id/versions', read, context.versions);
router.post('/connections/:id/versions', create, context.createVersion);
router.delete('/connections/:id/versions/:versionId', remove, context.deleteVersion);
router.patch('/connections/:id/draft', update, context.trackDraft);
router.get('/connections/:id/extraction', read, context.extraction);
router.put('/connections/:id/extraction', update, context.recordExtraction);
router.get('/connections/:id/understanding', read, context.understanding);
router.get('/connections/:id/context-objects', read, context.contextObjects);
router.get('/connections/:id/context-objects/by-table', read, context.factsByTable);
router.get('/connections/:id/model', read, context.model);
router.get('/connections/:id/review', read, context.review);
router.post('/connections/:id/review/:itemId/decision', update, context.decide);
router.patch('/connections/:id/review/:itemId', update, context.editItem);
router.post('/connections/:id/review/decision', update, context.bulkDecide);
router.get('/connections/:id/publish/summary', read, context.publishSummary);
router.post('/connections/:id/publish/validate', read, context.validatePublish);
router.get('/connections/:id/publish', read, context.publications);
router.post('/connections/:id/publish', publish, context.publish);
router.put('/connections/:id/datasets', update, context.selectDatasets);
router.delete('/connections/:id', remove, context.deleteConnection);

export = router;
