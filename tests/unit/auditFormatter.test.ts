import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as catalogueRepository from '../../src/modules/catalogue/catalogueRepository';
import { loadCatalogue } from '../../src/modules/catalogue/catalogueService';
import { formatFields, namesToResolve } from '../../src/modules/audit/auditFormatter';
import { shapeEntry } from '../../src/modules/audit/auditSerializer';
import type { AuditNames } from '../../src/modules/audit/auditFormatter';
import { catalogueRows } from './support/catalogueRows';

vi.mock('../../src/modules/catalogue/catalogueRepository', () => ({ loadAll: vi.fn() }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ANY_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function names(overrides: Partial<AuditNames> = {}): AuditNames {
  return { users: new Map(), roles: new Map(), groups: new Map(), dashboards: new Map(), ...overrides };
}

beforeAll(async () => {
  vi.mocked(catalogueRepository.loadAll).mockResolvedValue(catalogueRows() as any);
  await loadCatalogue();
});

describe('formatFields', () => {
  it('describes a role change in plain words without ids', () => {
    expect(
      formatFields({ roleId: uuid(1), userId: uuid(2), newRole: 'USER', roleChanged: true, targetUsername: 'john' })
    ).toEqual([
      { label: 'Person', value: 'john' },
      { label: 'Role changed', value: 'Yes' },
      { label: 'New role', value: 'Member' },
    ]);
  });

  it('never shows an id, even in fields it does not know', () => {
    const fields = formatFields({
      connectionId: uuid(3),
      connectionName: 'Sales',
      versionId: uuid(4),
      datasetIds: [uuid(5)],
      companyId: uuid(6),
      somethingNew: uuid(7),
      method: 'GET',
      path: `/api/users/${uuid(8)}`,
    });
    expect(fields).toEqual([
      { label: 'Connection', value: 'Sales' },
      { label: 'Request', value: 'GET /api/users/…' },
    ]);
    expect(JSON.stringify(fields)).not.toMatch(ANY_UUID);
  });

  it('looks up names for entries that only stored an id', () => {
    const fields = formatFields(
      { userId: uuid(1), roleId: uuid(2), groupId: uuid(3), dashboardId: 'sales', customRoleChanged: true },
      names({
        users: new Map([[uuid(1), 'anusha']]),
        roles: new Map([[uuid(2), 'test_QA']]),
        groups: new Map([[uuid(3), 'Analysts']]),
        dashboards: new Map([['sales', 'Sales overview']]),
      })
    );
    expect(fields).toEqual([
      { label: 'Person', value: 'anusha' },
      { label: 'Group', value: 'Analysts' },
      { label: 'Dashboard', value: 'Sales overview' },
      { label: 'Company role', value: 'test_QA' },
      { label: 'Company role changed', value: 'Yes' },
    ]);
  });

  it('leaves out an id it cannot name instead of showing it', () => {
    expect(formatFields({ userId: uuid(1), groupId: uuid(2), roleId: uuid(3) })).toEqual([]);
  });

  it('uses catalogue names and readable words for codes', () => {
    expect(
      formatFields({
        features: ['agents', 'context_layer'],
        reason: 'account_disabled',
        level: 'developer',
        soft: true,
        decision: 'approve',
      })
    ).toEqual([
      { label: 'Access', value: 'developer' },
      { label: 'Features', value: 'Agents, Context layer' },
      { label: 'Decision', value: 'Approve' },
      { label: 'Deleted permanently', value: 'No' },
      { label: 'Reason', value: 'Account disabled' },
    ]);
  });

  it('turns an unknown field name into words', () => {
    expect(formatFields({ someNewThing: true, total: 1200 })).toEqual([
      { label: 'Some new thing', value: 'Yes' },
      { label: 'Total', value: '1,200' },
    ]);
  });
});

describe('namesToResolve', () => {
  it('asks only for ids that have no name stored beside them', () => {
    expect(
      namesToResolve([
        { userId: uuid(1), targetUsername: 'john', roleId: uuid(2), role: 'USER' },
        { userId: uuid(3), groupId: uuid(4), dashboardId: 'default' },
        { groupId: uuid(5), groupName: 'Analysts', userId: 'not-an-id' },
      ])
    ).toEqual({ users: [uuid(3)], roles: [], groups: [uuid(4)], dashboards: ['default'] });
  });
});

describe('shapeEntry', () => {
  it('builds the summary from the readable fields and keeps the raw detail for the API', () => {
    const item = shapeEntry({
      ts: '2026-11-05T06:48:44.775Z',
      event: 'user_updated',
      actor: 'mojo',
      actorId: uuid(9),
      userId: uuid(2),
      targetUsername: 'john',
      roleChanged: true,
      newRole: 'USER',
    });
    expect(item.summary).toBe('Person: john · Role changed: Yes · New role: Member');
    expect(item.fields).toHaveLength(3);
    expect(item.detail.userId).toBe(uuid(2));
  });
});
