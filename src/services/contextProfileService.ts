import * as contextProfileRepository from '../repositories/contextProfileRepository';
import { shapeContextProfile } from '../views/serializers/contextProfileSerializer';
import { requireString } from '../validators/commonValidator';
import type { Actor } from '../types/actor';

type Connection = Record<string, any>;

async function contextProfile(connectionId: string): Promise<any> {
  return shapeContextProfile(await contextProfileRepository.find(connectionId));
}

async function saveContextProfile(connection: Connection, actor: Actor, body: Record<string, any>): Promise<any> {
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
