import * as contextProfileRepository from './contextProfileRepository';
import { shapeContextProfile } from './contextProfileSerializer';
import type { ContextProfileView } from './contextProfileSerializer';
import { requireString } from '../../shared/validation/commonValidator';
import type { Actor } from '../../shared/types/actor';
import type { RequestBody } from './contextTypes';

async function contextProfile(connectionId: string): Promise<ContextProfileView | null> {
  return shapeContextProfile(await contextProfileRepository.find(connectionId));
}

async function saveContextProfile(
  connection: { id: string; companyId: number },
  actor: Actor,
  body: RequestBody
): Promise<ContextProfileView> {
  const name = requireString(body.name, 'Context name', { max: 120 });
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) || null : null;

  const row = await contextProfileRepository.upsert({
    connectionId: connection.id,
    companyId: connection.companyId,
    name,
    description,
    createdBy: actor ? actor.id : null,
  });
  return shapeContextProfile(row);
}

export { contextProfile, saveContextProfile };
