import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as catalogueRepository from '../../src/repositories/catalogueRepository';
import { loadCatalogue } from '../../src/services/catalogueService';
import {
  assertCanAssignRole,
  assertCanManageUser,
  assertPermission,
  assertRolePermissionsAllowed,
  buildActor,
  can,
  levelAtLeast,
  missingFeature,
  resolveTargetCompany,
  strongestLevel,
} from '../../src/services/authorizationService';
import { catalogueRows } from './support/catalogueRows';
import { errorCode } from './support/errorCode';

vi.mock('../../src/repositories/catalogueRepository', () => ({ loadAll: vi.fn() }));

const ALL_FEATURES = ['metadata_lakehouse', 'agents', 'context_layer'];

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    username: 'ada',
    email: 'ada@example.com',
    display_name: 'Ada',
    role: 'USER',
    company_id: 1,
    status: 'active',
    must_change_password: false,
    ...overrides,
  };
}

const platformOwner = () => buildActor(userRow({ id: 1, role: 'SUPER_ADMIN', company_id: null }), []);
const companyAdmin = (companyId = 1) =>
  buildActor(
    userRow({ id: 2, role: 'COMPANY_ADMIN', company_id: companyId }),
    ['user.read', 'agent.run'],
    ['metadata_lakehouse']
  );
const member = (permissions: string[] = ['user.read']) =>
  buildActor(userRow(), permissions, ['metadata_lakehouse', 'agents']);

beforeAll(async () => {
  vi.mocked(catalogueRepository.loadAll).mockResolvedValue(catalogueRows() as any);
  await loadCatalogue();
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('buildActor', () => {
  it('shapes a company account', () => {
    const actor = buildActor(userRow({ role_id: 'r1', role_name: 'Analyst' }), ['user.read'], ['agents']);
    expect(actor).toMatchObject({
      id: 10,
      displayName: 'Ada',
      role: 'USER',
      roleScope: 'company',
      isPlatform: false,
      companyId: 1,
      permissions: ['user.read'],
      features: ['agents'],
      roleId: 'r1',
      roleName: 'Analyst',
    });
    expect(Object.isFrozen(actor.permissions)).toBe(true);
  });

  it('gives a platform account every feature and no company', () => {
    const actor = buildActor(userRow({ role: 'SUPER_ADMIN', company_id: null }), [], []);
    expect(actor.isPlatform).toBe(true);
    expect(actor.companyId).toBeNull();
    expect(actor.features).toEqual(ALL_FEATURES);
  });

  it('refuses rows that break the tenancy rules', () => {
    expect(errorCode(() => buildActor(userRow({ role: 'OWNER' }), []))).toBe('INTERNAL_ERROR');
    expect(errorCode(() => buildActor(userRow({ role: 'SUPER_ADMIN', company_id: 4 }), []))).toBe('INTERNAL_ERROR');
    expect(errorCode(() => buildActor(userRow({ company_id: null }), []))).toBe('INTERNAL_ERROR');
    expect(() => buildActor(null, [])).toThrow('buildActor requires a user row');
  });
});

describe('can and assertPermission', () => {
  it('lets the platform owner do anything the catalogue knows', () => {
    expect(can(platformOwner(), 'company.create')).toBe(true);
  });

  it('limits other accounts to the permissions they hold', () => {
    expect(can(member(), 'user.read')).toBe(true);
    expect(can(member(), 'company.read')).toBe(false);
    expect(can(null, 'user.read')).toBe(false);
  });

  it('fails loudly on a permission the catalogue does not know', () => {
    expect(() => can(member(), 'user.teleport')).toThrow('Unknown permission "user.teleport"');
  });

  it('says why a request is refused', () => {
    expect(errorCode(() => assertPermission(null, 'user.read'))).toBe('UNAUTHENTICATED');
    expect(errorCode(() => assertPermission(member(), 'company.read'))).toBe('INSUFFICIENT_PERMISSION');
    expect(errorCode(() => assertPermission(companyAdmin(), 'context.read'))).toBe('FEATURE_NOT_ENABLED');
    expect(errorCode(() => assertPermission(member(), 'user.read'))).toBeUndefined();
  });

  it('names the feature a company has switched off', () => {
    expect(missingFeature(companyAdmin(), 'agent.run')).toBe('agents');
    expect(missingFeature(companyAdmin(), 'user.read')).toBeNull();
    expect(missingFeature(platformOwner(), 'agent.run')).toBeNull();
  });
});

describe('resolveTargetCompany', () => {
  it('pins a company account to its own company', () => {
    expect(resolveTargetCompany(member(), 99)).toBe(1);
  });

  it('makes a platform account name a valid company', () => {
    expect(resolveTargetCompany(platformOwner(), '7')).toBe(7);
    expect(errorCode(() => resolveTargetCompany(platformOwner(), undefined))).toBe('VALIDATION_ERROR');
    expect(errorCode(() => resolveTargetCompany(platformOwner(), '-3'))).toBe('VALIDATION_ERROR');
  });
});

describe('dashboard levels', () => {
  it('picks the strongest known level', () => {
    expect(strongestLevel(['view', 'admin', 'developer'])).toBe('admin');
    expect(strongestLevel(['owner', 'view'])).toBe('view');
    expect(strongestLevel([])).toBeNull();
  });

  it('compares a level with a requirement', () => {
    expect(levelAtLeast('developer', 'view')).toBe(true);
    expect(levelAtLeast('view', 'developer')).toBe(false);
    expect(levelAtLeast(null, 'view')).toBe(false);
  });
});

describe('managing roles and accounts', () => {
  it('keeps the platform role for platform accounts', () => {
    expect(assertCanAssignRole(platformOwner(), 'SUPER_ADMIN')).toBe('platform');
    expect(errorCode(() => assertCanAssignRole(companyAdmin(), 'SUPER_ADMIN'))).toBe('INSUFFICIENT_PERMISSION');
    expect(assertCanAssignRole(companyAdmin(), 'USER')).toBe('company');
    expect(errorCode(() => assertCanAssignRole(companyAdmin(), 'OWNER'))).toBe('VALIDATION_ERROR');
  });

  it('lets a company admin manage the users of their own company only', () => {
    const admin = companyAdmin();
    expect(errorCode(() => assertCanManageUser(admin, userRow({ id: 30 })))).toBeUndefined();
    expect(errorCode(() => assertCanManageUser(admin, userRow({ id: 31, company_id: 2 })))).toBe(
      'TENANT_ACCESS_DENIED'
    );
    expect(errorCode(() => assertCanManageUser(admin, userRow({ id: 32, role: 'COMPANY_ADMIN' })))).toBe(
      'TENANT_ACCESS_DENIED'
    );
    expect(
      errorCode(() => assertCanManageUser(admin, userRow({ id: 33, role: 'SUPER_ADMIN', company_id: null })))
    ).toBe('TENANT_ACCESS_DENIED');
  });

  it('sends people to their profile for their own account', () => {
    const admin = companyAdmin();
    expect(errorCode(() => assertCanManageUser(admin, userRow({ id: admin.id, role: 'COMPANY_ADMIN' })))).toBe(
      'VALIDATION_ERROR'
    );
  });

  it('lets the platform owner manage any company account', () => {
    expect(
      errorCode(() => assertCanManageUser(platformOwner(), userRow({ id: 40, role: 'COMPANY_ADMIN', company_id: 5 })))
    ).toBeUndefined();
  });

  it('keeps platform permissions out of company roles', () => {
    expect(errorCode(() => assertRolePermissionsAllowed('company', ['user.read', 'company.create']))).toBe(
      'VALIDATION_ERROR'
    );
    expect(errorCode(() => assertRolePermissionsAllowed('company', ['user.read']))).toBeUndefined();
    expect(errorCode(() => assertRolePermissionsAllowed('platform', ['company.create']))).toBeUndefined();
  });
});
