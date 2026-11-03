import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as scopeRepository from '../../src/modules/users/scopeRepository';
import { replaceUserScopes } from '../../src/modules/users/scopeService';
import { rejectionCode } from './support/errorCode';

vi.mock('../../src/modules/users/scopeRepository', () => ({
  listDimensions: vi.fn(),
  replaceUserScopes: vi.fn(),
  userScopeRows: vi.fn(),
  distinctValues: vi.fn(),
}));
vi.mock('../../src/modules/audit/auditService', () => ({ audit: vi.fn(), EVENTS: { USER_SCOPE_UPDATED: 'x' } }));

const OWNER_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000042';
const actor: any = { id: OWNER_ID, username: 'owner' };
const user = { id: USER_ID, username: 'ada' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scopeRepository.listDimensions).mockResolvedValue([
    { dimension: 'theater', label: 'Theater', sourceTable: 'cinema_analysis', sourceColumn: 'Theater Name' } as any,
  ]);
  vi.mocked(scopeRepository.replaceUserScopes).mockResolvedValue(undefined as any);
  vi.mocked(scopeRepository.userScopeRows).mockResolvedValue([
    { dimension: 'theater', value: 'AMC' },
    { dimension: 'theater', value: 'Regal' },
  ] as any);
});

describe('replaceUserScopes', () => {
  it('stores each value once and answers with what is stored, not with the request', async () => {
    const result = await replaceUserScopes(actor, user, { theater: ['AMC', 'Regal', 'AMC'] });
    expect(scopeRepository.replaceUserScopes).toHaveBeenCalledWith(USER_ID, { theater: ['AMC', 'Regal'] }, OWNER_ID);
    expect(result).toEqual({ userId: USER_ID, scopes: { theater: ['AMC', 'Regal'] }, enforced: false });
  });

  it('refuses a dimension that does not exist without storing anything', async () => {
    expect(await rejectionCode(() => replaceUserScopes(actor, user, { region: ['North'] }))).toBe('VALIDATION_ERROR');
    expect(scopeRepository.replaceUserScopes).not.toHaveBeenCalled();
  });

  it('refuses scopes that are not an object of lists', async () => {
    expect(await rejectionCode(() => replaceUserScopes(actor, user, { theater: 'AMC' } as any))).toBe(
      'VALIDATION_ERROR'
    );
  });
});
