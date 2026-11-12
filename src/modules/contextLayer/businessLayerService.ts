import * as businessLayerRepository from './businessLayerRepository';
import { shapeBusinessLayer } from './businessLayerSerializer';
import type { BusinessLayerView } from './businessLayerSerializer';
import { cleanBusinessLayer } from './businessLayerValidator';
import * as versions from './versionService';
import type { Actor } from '../../shared/types/actor';
import type { DraftTarget, RequestBody } from './contextTypes';
import type { PublishedVersion } from './versionSerializer';

async function businessLayer(
  connection: { id: string; companyId: string | null },
  version: PublishedVersion | null
): Promise<BusinessLayerView> {
  const [row, organizationName] = await Promise.all([
    version
      ? businessLayerRepository.forPublished(connection.id, version.id)
      : businessLayerRepository.latest(connection.id),
    businessLayerRepository.companyName(connection.companyId),
  ]);
  return shapeBusinessLayer(row, organizationName);
}

async function saveBusinessLayer(actor: Actor, connection: DraftTarget, body: RequestBody): Promise<BusinessLayerView> {
  const layer = cleanBusinessLayer(body);
  await versions.touchDraft(actor, connection, { businessLayer: layer });
  return businessLayer(connection, null);
}

export { businessLayer, saveBusinessLayer };
