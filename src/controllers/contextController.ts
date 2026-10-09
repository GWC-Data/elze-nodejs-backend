import type { Request, Response } from 'express';
import { ok } from '../tools/apiResponse';
import * as contextLayer from '../services/contextLayerService';
import * as sharing from '../services/contextSharingService';

const body = (req: Request) => req.body || {};

function connectors(req: Request, res: Response): void {
  ok(res, contextLayer.listConnectors());
}

async function connections(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listConnections(req.actor));
}

async function publishedVersions(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listCompanyPublished(req.actor, req.query));
}

async function publishedConnections(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listPublishedConnections(req.actor));
}

async function publishedContexts(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listPublishedVersionOptions(req.actor));
}

async function mcp(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.mcpAccess(req.actor, req.params.id as string));
}

async function createConnection(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.createConnection(req.actor, body(req)), 201);
}

async function getConnection(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.getConnection(req.actor, req.params.id as string, req.query.version));
}

async function verifyConnection(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.verifyConnection(req.actor, req.params.id as string));
}

async function datasets(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listDatasets(req.actor, req.params.id as string, req.query));
}

async function profile(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.profile(req.actor, req.params.id as string, req.query.version));
}

async function table(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.tableProfile(req.actor, req.params.id as string, req.params.tableId as string, req.query.version));
}

async function versions(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.versionState(req.actor, req.params.id as string));
}

async function createVersion(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.createVersion(req.actor, req.params.id as string), 201);
}

async function deleteVersion(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.deleteVersion(req.actor, req.params.id as string, req.params.versionId as string));
}

async function trackDraft(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.trackDraft(req.actor, req.params.id as string, body(req).step));
}

async function contextProfile(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.contextProfile(req.actor, req.params.id as string));
}

async function saveContextProfile(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.saveContextProfile(req.actor, req.params.id as string, body(req)));
}

async function extraction(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.extraction(req.actor, req.params.id as string, req.query.version));
}

async function recordExtraction(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.recordExtraction(req.actor, req.params.id as string, body(req)));
}

async function understanding(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.understanding(req.actor, req.params.id as string, req.query));
}

async function contextObjects(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.contextObjects(req.actor, req.params.id as string, req.query));
}

async function factsByTable(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.factsByTable(req.actor, req.params.id as string, req.query));
}

async function model(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.model(req.actor, req.params.id as string, req.query));
}

async function review(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.review(req.actor, req.params.id as string, req.query));
}

async function decide(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.decide(req.actor, req.params.id as string, req.params.itemId as string, body(req)));
}

async function editItem(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.editItem(req.actor, req.params.id as string, req.params.itemId as string, body(req)));
}

async function bulkDecide(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.bulkDecide(req.actor, req.params.id as string, body(req)));
}

async function publishSummary(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.publishSummary(req.actor, req.params.id as string, req.query.version));
}

async function validatePublish(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.validatePublish(req.actor, req.params.id as string));
}

async function publications(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.listPublications(req.actor, req.params.id as string));
}

async function publish(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.publishContext(req.actor, req.params.id as string, body(req)), 201);
}

async function selectDatasets(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.selectDatasets(req.actor, req.params.id as string, body(req).datasets));
}

async function deleteConnection(req: Request, res: Response): Promise<void> {
  ok(res, await contextLayer.deleteConnection(req.actor, req.params.id as string));
}

async function access(req: Request, res: Response): Promise<void> {
  ok(res, await sharing.contextAccess(req.actor, req.params.id as string));
}

async function accessPeople(req: Request, res: Response): Promise<void> {
  ok(res, await sharing.shareablePeople(req.actor, req.params.id as string));
}

async function shareWithUser(req: Request, res: Response): Promise<void> {
  ok(res, await sharing.shareWithUser(req.actor, req.params.id as string, req.params.userId, body(req)));
}

async function unshareWithUser(req: Request, res: Response): Promise<void> {
  ok(res, await sharing.unshareWithUser(req.actor, req.params.id as string, req.params.userId));
}

async function setGeneralAccess(req: Request, res: Response): Promise<void> {
  ok(res, await sharing.setGeneralAccess(req.actor, req.params.id as string, body(req)));
}

export {
  connectors,
  connections,
  publishedVersions,
  publishedConnections,
  publishedContexts,
  mcp,
  createConnection,
  getConnection,
  verifyConnection,
  datasets,
  profile,
  table,
  versions,
  createVersion,
  deleteVersion,
  trackDraft,
  contextProfile,
  saveContextProfile,
  extraction,
  recordExtraction,
  understanding,
  contextObjects,
  factsByTable,
  model,
  review,
  decide,
  editItem,
  bulkDecide,
  publishSummary,
  validatePublish,
  publications,
  publish,
  selectDatasets,
  deleteConnection,
  access,
  accessPeople,
  shareWithUser,
  unshareWithUser,
  setGeneralAccess,
};
