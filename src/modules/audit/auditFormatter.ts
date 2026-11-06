import { accessLevelsFor, featureById, featureByKey, permissionByKey } from '../catalogue/catalogueService';
import { COMPANY_ADMIN, PLATFORM_ADMIN, SUPER_ADMIN, USER } from '../catalogue/roleTiers';
import { isUuid } from '../../shared/validation/commonValidator';

type Detail = Record<string, unknown>;

interface AuditField {
  label: string;
  value: string;
}

interface AuditNames {
  users: Map<string, string>;
  roles: Map<string, string>;
  groups: Map<string, string>;
  dashboards: Map<string, string>;
}

interface AuditNameIds {
  users: string[];
  roles: string[];
  groups: string[];
  dashboards: string[];
}

type Format = (value: unknown, detail: Detail, names: AuditNames) => string | null;

const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLE_LABELS: Record<string, string> = {
  [SUPER_ADMIN]: 'Platform owner',
  [PLATFORM_ADMIN]: 'Platform admin',
  [COMPANY_ADMIN]: 'Company admin',
  [USER]: 'Member',
};

const PERSON_KEYS = ['targetUsername', 'username', 'name'];
const ROLE_KEYS = ['role', 'roleName'];
const HIDDEN_KEYS = new Set(['id', 'method']);

const NO_NAMES: AuditNames = { users: new Map(), roles: new Map(), groups: new Map(), dashboards: new Map() };

function present(detail: Detail, keys: string[]): boolean {
  return keys.some((key) => detail[key] !== null && detail[key] !== undefined && detail[key] !== '');
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function humanise(key: string): string {
  return capitalise(
    key
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim()
  );
}

function plain(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('en-US') : null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || UUID_ONLY.test(text)) return null;
    return text.replace(UUID_ANYWHERE, '…');
  }
  if (Array.isArray(value)) {
    const items = value.map(plain).filter((item): item is string => item !== null);
    return items.length ? items.join(', ') : null;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value as Detail)
      .map(([key, inner]) => {
        const shown = plain(inner);
        return shown === null || UUID_ONLY.test(key) ? null : `${humanise(key)}: ${shown}`;
      })
      .filter((part): part is string => part !== null);
    return parts.length ? parts.join('; ') : null;
  }
  return null;
}

function words(value: unknown): string | null {
  const text = plain(value);
  return text === null ? null : capitalise(text.replace(/_/g, ' '));
}

function role(value: unknown): string | null {
  return typeof value === 'string' && ROLE_LABELS[value] ? ROLE_LABELS[value] : plain(value);
}

function level(value: unknown): string | null {
  if (typeof value !== 'string') return plain(value);
  const found = [...accessLevelsFor('dashboard'), ...accessLevelsFor('context')].find((l) => l.key === value);
  return found ? found.label : words(value);
}

function featureLabel(value: unknown): string | null {
  if (typeof value !== 'string') return plain(value);
  const found = featureByKey(value) ?? featureById(value);
  return found ? found.label : words(value);
}

function permissionLabel(value: unknown): string | null {
  if (typeof value !== 'string') return plain(value);
  return permissionByKey(value)?.label ?? plain(value);
}

function listOf(label: (value: unknown) => string | null): Format {
  return (value) => {
    const items = (Array.isArray(value) ? value : [value]).map(label).filter((item): item is string => item !== null);
    return items.length ? items.join(', ') : null;
  };
}

function lookup(names: Map<string, string>, value: unknown): string | null {
  return typeof value === 'string' ? (names.get(value.trim().toLowerCase()) ?? names.get(value) ?? null) : null;
}

const FIELDS: { key: string; label: string; format: Format }[] = [
  { key: 'targetUsername', label: 'Person', format: plain },
  { key: 'username', label: 'Person', format: plain },
  { key: 'userId', label: 'Person', format: (v, d, n) => (present(d, PERSON_KEYS) ? null : lookup(n.users, v)) },
  { key: 'targetEmail', label: 'Email', format: plain },
  { key: 'name', label: 'Name', format: plain },
  { key: 'groupName', label: 'Group', format: plain },
  { key: 'groupId', label: 'Group', format: (v, d, n) => (present(d, ['groupName']) ? null : lookup(n.groups, v)) },
  { key: 'connectionName', label: 'Connection', format: plain },
  { key: 'sharedCompanyName', label: 'Shared with company', format: plain },
  { key: 'dashboardId', label: 'Dashboard', format: (v, _d, n) => lookup(n.dashboards, v) ?? plain(v) },
  { key: 'provider', label: 'Source', format: words },
  { key: 'host', label: 'Host', format: plain },
  { key: 'role', label: 'Role', format: role },
  { key: 'roleName', label: 'Company role', format: plain },
  { key: 'roleId', label: 'Company role', format: (v, d, n) => (present(d, ROLE_KEYS) ? null : lookup(n.roles, v)) },
  { key: 'roleChanged', label: 'Role changed', format: plain },
  { key: 'newRole', label: 'New role', format: role },
  { key: 'customRoleChanged', label: 'Company role changed', format: plain },
  { key: 'builtIn', label: 'Built-in role', format: plain },
  { key: 'renamed', label: 'Renamed', format: plain },
  { key: 'reset', label: 'Reset to defaults', format: plain },
  { key: 'level', label: 'Access', format: level },
  { key: 'previousLevel', label: 'Previous access', format: level },
  { key: 'requiredLevel', label: 'Access needed', format: level },
  { key: 'generalAccess', label: 'General access', format: words },
  { key: 'previousGeneralAccess', label: 'Previous general access', format: words },
  { key: 'permission', label: 'Permission needed', format: permissionLabel },
  { key: 'path', label: 'Request', format: (v, d) => plain(typeof d.method === 'string' ? `${d.method} ${v}` : v) },
  { key: 'added', label: 'Permissions added', format: listOf(permissionLabel) },
  { key: 'removed', label: 'Permissions removed', format: listOf(permissionLabel) },
  { key: 'permissionCount', label: 'Permissions', format: plain },
  { key: 'features', label: 'Features', format: listOf(featureLabel) },
  { key: 'enabled', label: 'Features turned on', format: listOf(featureLabel) },
  { key: 'disabled', label: 'Features turned off', format: listOf(featureLabel) },
  { key: 'active', label: 'Active', format: plain },
  { key: 'activeChanged', label: 'Status changed', format: plain },
  { key: 'decision', label: 'Decision', format: words },
  { key: 'edited', label: 'Edited', format: plain },
  { key: 'bulk', label: 'Applied to many items', format: plain },
  { key: 'affected', label: 'Items changed', format: plain },
  { key: 'fields', label: 'Fields changed', format: plain },
  { key: 'version', label: 'Version', format: plain },
  { key: 'objectCount', label: 'Items', format: plain },
  { key: 'datasetCount', label: 'Datasets', format: plain },
  { key: 'datasetsListed', label: 'Datasets listed', format: plain },
  { key: 'datasetLimit', label: 'Dataset limit', format: plain },
  { key: 'datasetsTruncated', label: 'Dataset list cut short', format: plain },
  { key: 'memberCount', label: 'Members', format: plain },
  { key: 'membershipReplaced', label: 'Members changed', format: plain },
  { key: 'companiesFollowing', label: 'Companies using it', format: plain },
  { key: 'dimensions', label: 'Data access', format: plain },
  { key: 'action', label: 'Action', format: plain },
  { key: 'credits', label: 'Credits', format: plain },
  { key: 'previous', label: 'Previous', format: plain },
  { key: 'balance', label: 'Balance', format: plain },
  { key: 'limit', label: 'Limit', format: plain },
  { key: 'note', label: 'Note', format: plain },
  { key: 'wasAssigned', label: 'Was available', format: plain },
  { key: 'cardIndex', label: 'Card', format: plain },
  { key: 'permanent', label: 'Deleted permanently', format: plain },
  {
    key: 'soft',
    label: 'Deleted permanently',
    format: (v, d) => (present(d, ['permanent']) || typeof v !== 'boolean' ? null : plain(!v)),
  },
  { key: 'known', label: 'Known account', format: plain },
  { key: 'sent', label: 'Email sent', format: plain },
  { key: 'reason', label: 'Reason', format: words },
];

const KNOWN_KEYS = new Set(FIELDS.map((field) => field.key));

function hidden(key: string): boolean {
  return HIDDEN_KEYS.has(key) || /Ids?$/.test(key);
}

function formatFields(detail: Detail, names: AuditNames = NO_NAMES): AuditField[] {
  const fields: AuditField[] = [];
  for (const { key, label, format } of FIELDS) {
    if (!(key in detail) || detail[key] === null || detail[key] === undefined) continue;
    const value = format(detail[key], detail, names);
    if (value !== null) fields.push({ label, value });
  }
  for (const [key, raw] of Object.entries(detail)) {
    if (KNOWN_KEYS.has(key) || hidden(key)) continue;
    const value = plain(raw);
    if (value !== null) fields.push({ label: humanise(key), value });
  }
  return fields;
}

function namesToResolve(details: Detail[]): AuditNameIds {
  const users = new Set<string>();
  const roles = new Set<string>();
  const groups = new Set<string>();
  const dashboards = new Set<string>();
  for (const detail of details) {
    if (isUuid(detail.userId) && !present(detail, PERSON_KEYS)) users.add(detail.userId.trim().toLowerCase());
    if (isUuid(detail.roleId) && !present(detail, ROLE_KEYS)) roles.add(detail.roleId.trim().toLowerCase());
    if (isUuid(detail.groupId) && !present(detail, ['groupName'])) groups.add(detail.groupId.trim().toLowerCase());
    if (typeof detail.dashboardId === 'string' && detail.dashboardId.trim()) dashboards.add(detail.dashboardId.trim());
  }
  return { users: [...users], roles: [...roles], groups: [...groups], dashboards: [...dashboards] };
}

export { formatFields, namesToResolve, NO_NAMES };
export type { AuditField, AuditNames, AuditNameIds };
