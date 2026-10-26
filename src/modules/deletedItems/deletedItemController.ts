import type { Request, Response } from 'express';
import { ok } from '../../shared/http/apiResponse';
import { parseListQuery } from '../../shared/validation/listValidator';
import * as deletedItemService from './deletedItemService';

async function list(req: Request, res: Response): Promise<void> {
  const query = parseListQuery(req.query, deletedItemService.DELETED_ITEM_SORTS, {
    sort: 'deletedAt',
    dir: 'desc',
    pageSize: 15,
  });
  ok(
    res,
    await deletedItemService.listDeletedItems(req.actor, query, {
      type: req.query.type,
      companyId: req.query.companyId,
    })
  );
}

async function restore(req: Request, res: Response): Promise<void> {
  ok(res, await deletedItemService.restoreDeletedItem(req.actor, req.params.type, req.params.id));
}

async function purge(req: Request, res: Response): Promise<void> {
  ok(res, await deletedItemService.purgeDeletedItem(req.actor, req.params.type, req.params.id));
}

export { list, restore, purge };
