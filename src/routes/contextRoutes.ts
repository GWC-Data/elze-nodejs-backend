import express from 'express';
import { authenticated, requirePermission } from '../middleware/authMiddleware';
import * as context from '../controllers/contextController';

const router = express.Router();

const read = requirePermission('context.read');
const create = requirePermission('context.create');
const publish = requirePermission('context.publish');

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
router.put('/connections/:id/context', read, context.saveContextProfile);
router.post('/connections/:id/verify', read, context.verifyConnection);
router.get('/connections/:id/datasets', read, context.datasets);
router.get('/connections/:id/profile', read, context.profile);
router.get('/connections/:id/tables/:tableId', read, context.table);
router.get('/connections/:id/versions', read, context.versions);
router.post('/connections/:id/versions', read, context.createVersion);
router.delete('/connections/:id/versions/:versionId', read, context.deleteVersion);
router.patch('/connections/:id/draft', read, context.trackDraft);
router.get('/connections/:id/extraction', read, context.extraction);
router.put('/connections/:id/extraction', read, context.recordExtraction);
router.get('/connections/:id/understanding', read, context.understanding);
router.get('/connections/:id/context-objects', read, context.contextObjects);
router.get('/connections/:id/context-objects/by-table', read, context.factsByTable);
router.get('/connections/:id/model', read, context.model);
router.get('/connections/:id/review', read, context.review);
router.post('/connections/:id/review/:itemId/decision', read, context.decide);
router.patch('/connections/:id/review/:itemId', read, context.editItem);
router.post('/connections/:id/review/decision', read, context.bulkDecide);
router.get('/connections/:id/publish/summary', read, context.publishSummary);
router.post('/connections/:id/publish/validate', read, context.validatePublish);
router.get('/connections/:id/publish', read, context.publications);
router.post('/connections/:id/publish', publish, context.publish);
router.put('/connections/:id/datasets', read, context.selectDatasets);
router.delete('/connections/:id', read, context.deleteConnection);
router.get('/connections/:id/access', read, context.access);
router.get('/connections/:id/access/people', read, context.accessPeople);
router.put('/connections/:id/access/general', read, context.setGeneralAccess);
router.put('/connections/:id/access/users/:userId', read, context.shareWithUser);
router.delete('/connections/:id/access/users/:userId', read, context.unshareWithUser);

export = router;
