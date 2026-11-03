import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as catalogueRepository from '../../src/modules/catalogue/catalogueRepository';
import * as catalogue from '../../src/modules/catalogue/catalogueService';
import { catalogueRows, FEATURE } from './support/catalogueRows';

vi.mock('../../src/modules/catalogue/catalogueRepository', () => ({ loadAll: vi.fn() }));

const loadAll = vi.mocked(catalogueRepository.loadAll);

describe('loading', () => {
  it('refuses to answer before the catalogue is loaded', () => {
    expect(() => catalogue.permissionKeys()).toThrow('The catalogue has not been loaded');
  });

  it('refuses a catalogue that is missing rows the code relies on', async () => {
    const rows = catalogueRows();
    rows.systemRoles = rows.systemRoles.filter((r) => r.tier !== 'USER');
    rows.accessLevels = rows.accessLevels.filter((l) => l.resource !== 'context');
    rows.auditEventTypes = rows.auditEventTypes.filter((e) => e.key !== 'login_success');
    loadAll.mockResolvedValueOnce(rows as any);

    await expect(catalogue.loadCatalogue()).rejects.toThrow(
      'the catalogue in the database is incomplete: system role USER, context access levels, audit event type login_success.'
    );
    expect(() => catalogue.permissionKeys()).toThrow('has not been loaded');
  });
});

describe('a loaded catalogue', () => {
  beforeAll(async () => {
    loadAll.mockResolvedValue(catalogueRows() as any);
    await catalogue.loadCatalogue();
  });

  describe('permissions', () => {
    it('lists the keys in catalogue order', () => {
      expect(catalogue.permissionKeys()).toEqual([
        'company.read',
        'company.create',
        'user.read',
        'role.update',
        'data.read',
        'agent.run',
        'context.read',
      ]);
    });

    it('knows its own permissions only', () => {
      expect(catalogue.isKnownPermission('user.read')).toBe(true);
      expect(catalogue.isKnownPermission('user.fly')).toBe(false);
    });

    it('maps keys to ids and back, dropping unknown entries', () => {
      expect(catalogue.permissionIdsOf(['user.read', 'nope', 'agent.run'])).toEqual([
        'perm-user-read',
        'perm-agent-run',
      ]);
      expect(catalogue.permissionKeysOf(['perm-agent-run', 'perm-missing'])).toEqual(['agent.run']);
      expect(catalogue.permissionKeysOf(null)).toEqual([]);
    });

    it('reports the platform-only and admin-only flags', () => {
      expect(catalogue.isPlatformOnly('company.create')).toBe(true);
      expect(catalogue.isPlatformOnly('company.read')).toBe(false);
      expect(catalogue.isAdminOnly('role.update')).toBe(true);
      expect(catalogue.isPlatformOnly('unknown')).toBe(false);
    });

    it('names the feature a permission belongs to', () => {
      expect(catalogue.featureOfPermission('agent.run')).toBe('agents');
      expect(catalogue.featureOfPermission('user.read')).toBeNull();
    });
  });

  describe('features', () => {
    it('lists the permissions each feature covers', () => {
      expect(catalogue.featureByKey('agents')?.permissions).toEqual(['agent.run']);
      expect(catalogue.featureById(FEATURE.lakehouse)?.key).toBe('metadata_lakehouse');
    });

    it('only lets unlocked features be toggled', () => {
      expect(catalogue.toggleableFeatureKeys()).toEqual(['agents', 'context_layer']);
    });

    it('always enables locked features, drops unknown ones and keeps catalogue order', () => {
      expect(catalogue.effectiveFeatures(['context_layer', 'retired_feature'])).toEqual([
        'metadata_lakehouse',
        'context_layer',
      ]);
      expect(catalogue.effectiveFeatures(null)).toEqual(['metadata_lakehouse']);
    });

    it('maps feature keys to ids and back', () => {
      expect(catalogue.featureIdsOf(['agents', 'nope'])).toEqual([FEATURE.agents]);
      expect(catalogue.featureKeysOf([FEATURE.context, 'missing'])).toEqual(['context_layer']);
    });

    it('masks permissions whose feature is off', () => {
      const enabled = ['metadata_lakehouse'];
      expect(catalogue.maskPermissions(['user.read', 'data.read', 'agent.run'], enabled)).toEqual([
        'user.read',
        'data.read',
      ]);
      expect(catalogue.isPermissionEnabled('agent.run', enabled)).toBe(false);
    });

    it('treats a feature as usable only when a permission in it is held', () => {
      expect(catalogue.usableFeatures(['agents', 'context_layer'], ['agent.run'])).toEqual(['agents']);
    });
  });

  describe('access levels', () => {
    it('lists the keys of a resource in rank order', () => {
      expect(catalogue.accessLevelKeys('dashboard')).toEqual(['view', 'developer', 'admin']);
      expect(catalogue.accessLevelKeys('context')).toEqual(['read', 'edit']);
    });

    it('ranks levels and gives an unknown or empty level rank 0', () => {
      expect(catalogue.levelRank('dashboard', 'admin')).toBe(3);
      expect(catalogue.levelRank('dashboard', 'edit')).toBe(0);
      expect(catalogue.levelRank('dashboard', null)).toBe(0);
    });

    it('maps level keys to ids within one resource', () => {
      expect(catalogue.accessLevelId('context', 'edit')).toBe('level-context-edit');
      expect(() => catalogue.accessLevelId('context', 'admin')).toThrow('Unknown context access level "admin".');
      expect(catalogue.accessLevelKeyOf('dashboard', 'level-dash-view')).toBe('view');
      expect(catalogue.accessLevelKeyOf('context', 'level-dash-view')).toBeNull();
    });
  });

  describe('system roles, connectors and audit events', () => {
    it('finds the system role of each tier', () => {
      expect(catalogue.systemRoleId('COMPANY_ADMIN')).toBe('role-company-admin');
      expect(catalogue.systemRoleIds()).toHaveLength(4);
      expect(() => catalogue.systemRoleId('OWNER')).toThrow('Unknown system role "OWNER".');
    });

    it('finds a connector whatever the case or spacing of its id', () => {
      expect(catalogue.findConnector('  DOMO ')?.name).toBe('Domo');
      expect(catalogue.findConnector('oracle')).toBeNull();
    });

    it('leaves out a docs link and credentials a connector does not have', () => {
      const snowflake = catalogue.findConnector('snowflake');
      expect(snowflake).not.toHaveProperty('docsUrl');
      expect(snowflake?.credentials).toEqual([]);
      expect(snowflake?.description).toBe('');
    });

    it('groups audit events by category and action, and rejects unknown ones', () => {
      expect(catalogue.auditEventsInCategory('company')).toContain('company_created');
      expect(catalogue.auditEventsInCategory('auth')).not.toContain('company_created');
      expect(catalogue.auditEventsInCategory('weather')).toBeNull();
      expect(catalogue.auditEventsWithAction('create')).toContain('company_created');
      expect(catalogue.auditEventsWithAction('teleport')).toBeNull();
      expect(catalogue.auditEventLabel('logout')).toBe('Label of logout');
    });
  });
});
