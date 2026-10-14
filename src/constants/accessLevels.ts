import { LEVEL_RANK, ACCESS_LEVEL_LABELS } from './permissions';
import { CONTEXT_LEVEL_RANK } from './context';

type AccessResource = 'dashboard' | 'context';

interface AccessLevel {
  id: string;
  resource: AccessResource;
  key: string;
  rank: number;
  label: string;
  description: string;
}

const ACCESS_LEVEL_CATALOGUE: AccessLevel[] = [
  { id: '5307098d-f2b9-4bb1-bb6f-17d0157fc497', resource: 'dashboard', key: 'view', rank: LEVEL_RANK.view, label: 'Can view', description: ACCESS_LEVEL_LABELS.view },
  { id: '069b9393-83ee-435b-af07-0fdb1f74ab86', resource: 'dashboard', key: 'share', rank: LEVEL_RANK.share, label: 'Can share', description: ACCESS_LEVEL_LABELS.share },
  { id: '24417946-56df-4344-9958-c0ba26c1d8af', resource: 'dashboard', key: 'developer', rank: LEVEL_RANK.developer, label: 'Can edit', description: ACCESS_LEVEL_LABELS.developer },
  { id: '76f9f133-68d9-41ef-8ed1-a92c65c53135', resource: 'dashboard', key: 'admin', rank: LEVEL_RANK.admin, label: 'Full control', description: ACCESS_LEVEL_LABELS.admin },
  { id: 'd3128419-d42c-4783-b651-6d7f176cc813', resource: 'context', key: 'view', rank: CONTEXT_LEVEL_RANK.view, label: 'Can view', description: 'Open the draft and every published version, read-only.' },
  { id: 'b867ada1-5e89-4675-8792-951b56d1695d', resource: 'context', key: 'edit', rank: CONTEXT_LEVEL_RANK.edit, label: 'Can edit', description: 'Also change the draft: datasets, analysis, review and descriptions.' },
  { id: '80bb5d1c-7589-485f-b1cd-32fe6993d8b3', resource: 'context', key: 'full', rank: CONTEXT_LEVEL_RANK.full, label: 'Full access', description: 'Also delete the context and its published versions.' },
];

const ACCESS_LEVEL_BY_ID = new Map(ACCESS_LEVEL_CATALOGUE.map((l) => [l.id, l]));

function accessLevelsFor(resource: AccessResource): AccessLevel[] {
  return ACCESS_LEVEL_CATALOGUE.filter((l) => l.resource === resource);
}

function accessLevelId(resource: AccessResource, key: string): string {
  const level = ACCESS_LEVEL_CATALOGUE.find((l) => l.resource === resource && l.key === key);
  if (!level) throw new Error(`Unknown ${resource} access level "${key}".`);
  return level.id;
}

function accessLevelKeyOf(resource: AccessResource, id: unknown): string | null {
  const level = ACCESS_LEVEL_BY_ID.get(String(id || ''));
  return level && level.resource === resource ? level.key : null;
}

export { ACCESS_LEVEL_CATALOGUE, ACCESS_LEVEL_BY_ID, accessLevelsFor, accessLevelId, accessLevelKeyOf };
export type { AccessLevel, AccessResource };
