import * as catalogueRepository from './catalogueRepository';
import { ROLE_TIERS } from './roleTiers';
import { EVENTS } from '../audit/auditEvents';

type AccessResource = 'dashboard' | 'context';

interface PermissionDef {
  id: string;
  key: string;
  label: string;
  description: string;
  featureId: string | null;
  featureKey: string | null;
  platformOnly: boolean;
  adminOnly: boolean;
}

interface FeatureDef {
  id: string;
  key: string;
  label: string;
  description: string;
  locked: boolean;
  covers: string[];
  permissions: string[];
}

interface AccessLevel {
  id: string;
  resource: AccessResource;
  key: string;
  rank: number;
  label: string;
  description: string;
}

interface SystemRole {
  id: string;
  tier: string;
  name: string;
  description: string;
}

interface CredentialField {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  help: string;
}

interface Connector {
  id: string;
  name: string;
  status: string;
  description: string;
  docsUrl?: string;
  credentials: CredentialField[];
}

interface AuditEventType {
  key: string;
  label: string;
  categories: string[];
  action: string | null;
}

interface Catalogue {
  permissions: PermissionDef[];
  permissionByKey: Map<string, PermissionDef>;
  permissionById: Map<string, PermissionDef>;
  features: FeatureDef[];
  featureByKey: Map<string, FeatureDef>;
  featureById: Map<string, FeatureDef>;
  accessLevels: AccessLevel[];
  accessLevelById: Map<string, AccessLevel>;
  systemRoleByTier: Map<string, SystemRole>;
  connectors: Connector[];
  connectorById: Map<string, Connector>;
  auditEventTypes: AuditEventType[];
  auditEventTypeByKey: Map<string, AuditEventType>;
}

let current: Catalogue | null = null;

function build(rows: Awaited<ReturnType<typeof catalogueRepository.loadAll>>): Catalogue {
  const featureKeyById = new Map(rows.features.map((f) => [f.id, f.key]));
  const permissions: PermissionDef[] = rows.permissions.map((p) => ({
    id: p.id,
    key: p.key,
    label: p.label,
    description: p.description || '',
    featureId: p.featureId,
    featureKey: p.featureId ? featureKeyById.get(p.featureId) || null : null,
    platformOnly: p.platformOnly,
    adminOnly: p.adminOnly,
  }));
  const features: FeatureDef[] = rows.features.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    description: f.description || '',
    locked: f.locked,
    covers: f.covers,
    permissions: permissions.filter((p) => p.featureId === f.id).map((p) => p.key),
  }));
  const accessLevels: AccessLevel[] = rows.accessLevels.map((l) => ({
    id: l.id,
    resource: l.resource as AccessResource,
    key: l.key,
    rank: l.rank,
    label: l.label,
    description: l.description || '',
  }));
  const connectors: Connector[] = rows.connectors.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    description: c.description || '',
    ...(c.docsUrl ? { docsUrl: c.docsUrl } : {}),
    credentials: (Array.isArray(c.credentials) ? c.credentials : []) as unknown as CredentialField[],
  }));
  const auditEventTypes: AuditEventType[] = rows.auditEventTypes.map((e) => ({
    key: e.key,
    label: e.label,
    categories: e.categories,
    action: e.action,
  }));
  return {
    permissions,
    permissionByKey: new Map(permissions.map((p) => [p.key, p])),
    permissionById: new Map(permissions.map((p) => [p.id, p])),
    features,
    featureByKey: new Map(features.map((f) => [f.key, f])),
    featureById: new Map(features.map((f) => [f.id, f])),
    accessLevels,
    accessLevelById: new Map(accessLevels.map((l) => [l.id, l])),
    systemRoleByTier: new Map(
      rows.systemRoles.map((r) => [
        r.tier,
        {
          id: r.id,
          tier: r.tier,
          name: r.name,
          description: r.description || '',
        },
      ])
    ),
    connectors,
    connectorById: new Map(connectors.map((c) => [c.id, c])),
    auditEventTypes,
    auditEventTypeByKey: new Map(auditEventTypes.map((e) => [e.key, e])),
  };
}

function assertComplete(next: Catalogue): void {
  const missing: string[] = [];
  for (const tier of ROLE_TIERS) if (!next.systemRoleByTier.has(tier)) missing.push(`system role ${tier}`);
  for (const resource of ['dashboard', 'context']) {
    if (!next.accessLevels.some((l) => l.resource === resource)) missing.push(`${resource} access levels`);
  }
  for (const event of Object.values(EVENTS)) {
    if (!next.auditEventTypeByKey.has(event)) missing.push(`audit event type ${event}`);
  }
  if (missing.length) {
    throw new Error(
      `the catalogue in the database is incomplete: ${missing.join(', ')}. Add the rows with a migration.`
    );
  }
}

async function loadCatalogue(): Promise<void> {
  const next = build(await catalogueRepository.loadAll());
  assertComplete(next);
  current = next;
}

function catalogue(): Catalogue {
  if (!current) throw new Error('The catalogue has not been loaded: call loadCatalogue() at startup.');
  return current;
}

function allPermissions(): readonly PermissionDef[] {
  return catalogue().permissions;
}

function permissionKeys(): string[] {
  return catalogue().permissions.map((p) => p.key);
}

function isKnownPermission(key: string): boolean {
  return catalogue().permissionByKey.has(key);
}

function permissionByKey(key: string): PermissionDef | undefined {
  return catalogue().permissionByKey.get(key);
}

function permissionIdsOf(keys: readonly string[]): string[] {
  const byKey = catalogue().permissionByKey;
  return keys.map((key) => byKey.get(key)?.id).filter((id): id is string => Boolean(id));
}

function permissionKeysOf(ids: readonly string[] | null | undefined): string[] {
  const byId = catalogue().permissionById;
  return (ids || []).map((id) => byId.get(String(id))?.key).filter((key): key is string => Boolean(key));
}

function isPlatformOnly(key: string): boolean {
  return Boolean(catalogue().permissionByKey.get(key)?.platformOnly);
}

function isAdminOnly(key: string): boolean {
  return Boolean(catalogue().permissionByKey.get(key)?.adminOnly);
}

function allFeatures(): readonly FeatureDef[] {
  return catalogue().features;
}

function featureKeys(): string[] {
  return catalogue().features.map((f) => f.key);
}

function toggleableFeatureKeys(): string[] {
  return catalogue()
    .features.filter((f) => !f.locked)
    .map((f) => f.key);
}

function featureByKey(key: string): FeatureDef | undefined {
  return catalogue().featureByKey.get(key);
}

function featureById(id: string): FeatureDef | undefined {
  return catalogue().featureById.get(id);
}

function featureOfPermission(permission: string): string | null {
  return catalogue().permissionByKey.get(permission)?.featureKey ?? null;
}

function featureIdsOf(keys: readonly string[]): string[] {
  const byKey = catalogue().featureByKey;
  return keys.map((key) => byKey.get(key)?.id).filter((id): id is string => Boolean(id));
}

function featureKeysOf(ids: readonly string[] | null | undefined): string[] {
  const byId = catalogue().featureById;
  return (ids || []).map((id) => byId.get(String(id))?.key).filter((key): key is string => Boolean(key));
}

function effectiveFeatures(stored: readonly string[] | null | undefined): string[] {
  const { features, featureByKey: byKey } = catalogue();
  const enabled = new Set(features.filter((f) => f.locked).map((f) => f.key));
  for (const key of stored || []) if (byKey.has(key)) enabled.add(key);
  return features.map((f) => f.key).filter((key) => enabled.has(key));
}

function isPermissionEnabled(permission: string, features: readonly string[]): boolean {
  const feature = featureOfPermission(permission);
  return !feature || features.includes(feature);
}

function maskPermissions(permissions: readonly string[], features: readonly string[]): string[] {
  return permissions.filter((p) => isPermissionEnabled(p, features));
}

function usableFeatures(features: readonly string[], permissions: readonly string[]): string[] {
  const byKey = catalogue().featureByKey;
  return features.filter((feature) => (byKey.get(feature)?.permissions || []).some((p) => permissions.includes(p)));
}

function accessLevelsFor(resource: AccessResource): AccessLevel[] {
  return catalogue().accessLevels.filter((l) => l.resource === resource);
}

function accessLevelKeys(resource: AccessResource): string[] {
  return accessLevelsFor(resource).map((l) => l.key);
}

function accessLevelId(resource: AccessResource, key: string): string {
  const level = catalogue().accessLevels.find((l) => l.resource === resource && l.key === key);
  if (!level) throw new Error(`Unknown ${resource} access level "${key}".`);
  return level.id;
}

function accessLevelKeyOf(resource: AccessResource, id: unknown): string | null {
  const level = catalogue().accessLevelById.get(String(id || ''));
  return level && level.resource === resource ? level.key : null;
}

function levelRank(resource: AccessResource, key: string | null | undefined): number {
  if (!key) return 0;
  return catalogue().accessLevels.find((l) => l.resource === resource && l.key === key)?.rank || 0;
}

function systemRoleId(tier: string): string {
  const role = catalogue().systemRoleByTier.get(tier);
  if (!role) throw new Error(`Unknown system role "${tier}".`);
  return role.id;
}

function systemRoles(): SystemRole[] {
  return [...catalogue().systemRoleByTier.values()];
}

function systemRoleIds(): string[] {
  return systemRoles().map((r) => r.id);
}

function connectors(): readonly Connector[] {
  return catalogue().connectors;
}

function findConnector(id: unknown): Connector | null {
  return (
    catalogue().connectorById.get(
      String(id || '')
        .trim()
        .toLowerCase()
    ) || null
  );
}

function auditEventLabel(event: string): string | undefined {
  return catalogue().auditEventTypeByKey.get(event)?.label;
}

function auditCategories(): string[] {
  return [...new Set(catalogue().auditEventTypes.flatMap((e) => e.categories))];
}

function auditActions(): string[] {
  return [
    ...new Set(
      catalogue()
        .auditEventTypes.map((e) => e.action)
        .filter((a): a is string => Boolean(a))
    ),
  ];
}

function auditEventsInCategory(category: string): string[] | null {
  if (!auditCategories().includes(category)) return null;
  return catalogue()
    .auditEventTypes.filter((e) => e.categories.includes(category))
    .map((e) => e.key);
}

function auditEventsWithAction(action: string): string[] | null {
  if (!auditActions().includes(action)) return null;
  return catalogue()
    .auditEventTypes.filter((e) => e.action === action)
    .map((e) => e.key);
}

export {
  loadCatalogue,
  allPermissions,
  permissionKeys,
  isKnownPermission,
  permissionByKey,
  permissionIdsOf,
  permissionKeysOf,
  isPlatformOnly,
  isAdminOnly,
  allFeatures,
  featureKeys,
  toggleableFeatureKeys,
  featureByKey,
  featureById,
  featureOfPermission,
  featureIdsOf,
  featureKeysOf,
  effectiveFeatures,
  isPermissionEnabled,
  maskPermissions,
  usableFeatures,
  accessLevelsFor,
  accessLevelKeys,
  accessLevelId,
  accessLevelKeyOf,
  levelRank,
  systemRoleId,
  systemRoles,
  systemRoleIds,
  connectors,
  findConnector,
  auditEventLabel,
  auditCategories,
  auditActions,
  auditEventsInCategory,
  auditEventsWithAction,
};
export type { AccessResource, AccessLevel, PermissionDef, FeatureDef, Connector, AuditEventType };
