import * as accessRepository from '../repositories/accessRepository';
import { fail } from '../tools/AppError';
import { requireLevel } from '../validators/accessValidator';
import { dashboardSummary } from '../views/serializers/dashboardSerializer';
import { can, strongestLevel, levelAtLeast, resolveTargetCompany } from './authorizationService';
import { requireCompany } from './companyService';
import { requireGroupInScope } from './groupService';
import { requireUserInScope, listUserOptions } from './userService';
import * as dashboards from './dashboardService';
import { audit, EVENTS } from './auditService';
import { ACCESS_LEVELS, ACCESS_LEVEL_LABELS } from '../constants/permissions';
import type { Actor } from '../types/actor';

type GrantAction = 'read' | 'grant' | 'revoke';
type DashboardRecord = Record<string, any>;

interface GrantAuthority {
  full: boolean;
  level: string | null;
}

const AUTHORITY: Record<GrantAction, { permission: string; level: string }> = {
  read: { permission: 'access.read', level: 'share' },
  grant: { permission: 'access.grant', level: 'share' },
  revoke: { permission: 'access.revoke', level: 'admin' },
};

async function requireDashboardId(dashboardId: unknown): Promise<string> {
  const id = String(dashboardId || '');
  if (!(await dashboards.dashboardExists(id))) {
    throw fail('DASHBOARD_NOT_FOUND', 'Dashboard not found');
  }
  return id;
}

async function listCompanyDashboards(companyId: number | null) {
  const [assigned, all] = await Promise.all([
    accessRepository.companyDashboardIds(companyId),
    dashboards.listDashboards(companyId),
  ]);
  return all.filter((d: DashboardRecord) => assigned.has(d.id)).map((d: DashboardRecord) => dashboardSummary(d));
}

async function listAssignableDashboards(companyId: number | null) {
  const [assigned, all] = await Promise.all([
    accessRepository.companyDashboardIds(companyId),
    dashboards.listDashboards(),
  ]);
  return all.map((d: DashboardRecord) => dashboardSummary(d, { assigned: assigned.has(d.id) }));
}

async function assignDashboard(actor: Actor, companyId: number, rawDashboardId: unknown) {
  const dashboardId = await requireDashboardId(rawDashboardId);
  await accessRepository.assign(companyId, dashboardId, actor.id);
  audit(EVENTS.DASHBOARD_ASSIGNED, actor, { companyId, dashboardId });
  return { companyId, dashboardId, assigned: true };
}

async function unassignDashboard(actor: Actor, companyId: number, dashboardId: string) {
  const removed = await accessRepository.unassign(companyId, dashboardId);
  audit(EVENTS.DASHBOARD_UNASSIGNED, actor, { companyId, dashboardId, wasAssigned: removed });
  return { companyId, dashboardId, assigned: false };
}

async function assertDashboardAssigned(actor: Actor, companyId: number | null, dashboardId: string): Promise<void> {
  if (actor.isPlatform && companyId === null) return;
  if (!(await accessRepository.isAvailable(companyId, dashboardId))) {
    throw fail('TENANT_ACCESS_DENIED', 'That dashboard is not available to this company.');
  }
}

async function getAccessLevel(actor: Actor | null | undefined, dashboardId: string | null | undefined): Promise<string | null> {
  if (!actor || !dashboardId) return null;
  if (actor.isPlatform) return 'admin';

  const gate = await accessRepository.gateAndLevels(actor, dashboardId);
  if (!gate || !gate.available) return null;

  if (can(actor, 'access.grant')) return 'admin';

  return strongestLevel(gate.levels || []);
}

async function assertDashboardLevel(actor: Actor, dashboardId: string, required: string): Promise<string> {
  const level = await getAccessLevel(actor, dashboardId);
  if (!level) {
    throw fail('DASHBOARD_NOT_FOUND', 'Dashboard not found');
  }
  if (!levelAtLeast(level, required)) {
    throw fail('INSUFFICIENT_PERMISSION', `This action needs "${required}" access to the dashboard.`);
  }
  return level;
}

async function listAccessibleDashboards(actor: Actor) {
  if (actor.isPlatform) {
    const all = await dashboards.listDashboards();
    return all.map((d: DashboardRecord) => dashboardSummary(d, { accessLevel: 'admin' }));
  }

  const grantsAll = can(actor, 'access.grant');

  const [assigned, all, rows] = await Promise.all([
    accessRepository.companyDashboardIds(actor.companyId),
    dashboards.listDashboards(actor.companyId),
    grantsAll ? Promise.resolve([]) : accessRepository.grantRowsForUser(actor),
  ]);
  const visible = all.filter((d: DashboardRecord) => assigned.has(d.id));

  if (grantsAll) {
    return visible.map((d: DashboardRecord) => dashboardSummary(d, { accessLevel: 'admin' }));
  }

  const byDashboard = new Map<string, string | null>();
  for (const row of rows) {
    byDashboard.set(
      row.dashboard_id,
      strongestLevel([byDashboard.get(row.dashboard_id), row.access_level].filter(Boolean))
    );
  }

  return visible
    .filter((d: DashboardRecord) => byDashboard.has(d.id))
    .map((d: DashboardRecord) => dashboardSummary(d, { accessLevel: byDashboard.get(d.id) }));
}

async function countAccessibleDashboards(actor: Actor): Promise<number> {
  if (actor.isPlatform) return dashboards.countDashboards();
  if (can(actor, 'access.grant')) return accessRepository.countCompanyDashboards(actor.companyId);
  return accessRepository.countGrantedDashboards(actor);
}

async function listUserGrants(userId: number) {
  const [rows, titles] = await Promise.all([
    accessRepository.userGrantRows(userId),
    dashboards.dashboardTitles(),
  ]);
  return rows.map((row: Record<string, any>) => {
    const grant: Record<string, any> = {
      dashboardId: row.dashboardId,
      dashboardTitle: titles.get(row.dashboardId) || null,
      level: row.level,
      origin: row.origin,
    };
    if (row.origin === 'group') Object.assign(grant, { groupId: row.groupId, groupName: row.groupName });
    return grant;
  });
}

async function listDashboardGrants(companyId: number, dashboardId: string) {
  const [users, groups] = await Promise.all([
    accessRepository.dashboardUserGrants(companyId, dashboardId),
    accessRepository.dashboardGroupGrants(companyId, dashboardId),
  ]);
  return {
    dashboardId,
    users,
    groups: groups.map((g: Record<string, any>) => ({ ...g, active: Boolean(g.active) })),
  };
}

function describeLevels() {
  return ACCESS_LEVELS.map((id) => ({ id, description: ACCESS_LEVEL_LABELS[id] }));
}

async function resolveGrantTarget(actor: Actor, requestedCompanyId: unknown, dashboardId: unknown) {
  const companyId = resolveTargetCompany(actor, requestedCompanyId);
  const id = String(dashboardId || '');

  const outcomes = await Promise.allSettled([
    requireCompany(actor, companyId),
    requireDashboardId(id),
    assertDashboardAssigned(actor, companyId, id),
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason;
  }
  return { companyId, dashboardId: id };
}

async function grantAuthority(actor: Actor, dashboardId: string, action: GrantAction): Promise<GrantAuthority> {
  const rule = AUTHORITY[action];
  if (can(actor, rule.permission)) return { full: true, level: 'admin' };

  const level = await getAccessLevel(actor, dashboardId);
  if (!levelAtLeast(level, rule.level)) {
    throw fail(
      'INSUFFICIENT_PERMISSION',
      action === 'revoke'
        ? 'Removing access needs "Full control" of this dashboard.'
        : 'Sharing needs at least "Can share" on this dashboard.'
    );
  }
  return { full: false, level };
}

async function assertSharerMayChange(
  actor: Actor,
  authority: GrantAuthority,
  userId: number,
  dashboardId: string,
  level: string | null
): Promise<void> {
  if (authority.full) return;
  if (Number(userId) === Number(actor.id)) {
    throw fail('INSUFFICIENT_PERMISSION', 'You cannot change your own access to a dashboard.');
  }
  if (level && !levelAtLeast(authority.level, level)) {
    throw fail(
      'INSUFFICIENT_PERMISSION',
      `You can give at most the access you hold yourself ("${authority.level}").`
    );
  }
  const current = await accessRepository.directUserLevel(userId, dashboardId);
  if (current && !levelAtLeast(authority.level, current)) {
    throw fail(
      'INSUFFICIENT_PERMISSION',
      'That person holds more access to this dashboard than you do, so only someone with more can change it.'
    );
  }
}

async function grantableDashboards(actor: Actor, requestedCompanyId: unknown) {
  const companyId = resolveTargetCompany(actor, requestedCompanyId);
  await requireCompany(actor, companyId);
  return listCompanyDashboards(companyId);
}

async function dashboardGrants(actor: Actor, requestedCompanyId: unknown, rawDashboardId: unknown) {
  const { companyId, dashboardId } = await resolveGrantTarget(actor, requestedCompanyId, rawDashboardId);
  const authority = await grantAuthority(actor, dashboardId, 'read');
  return {
    ...(await listDashboardGrants(companyId, dashboardId)),
    you: {
      userId: actor.id,
      level: authority.level,
      administrator: authority.full,
      mayRevoke: authority.full ? can(actor, 'access.revoke') : levelAtLeast(authority.level, 'admin'),
    },
  };
}

async function shareablePeople(actor: Actor, requestedCompanyId: unknown, rawDashboardId: unknown) {
  const { dashboardId } = await resolveGrantTarget(actor, requestedCompanyId, rawDashboardId);
  await grantAuthority(actor, dashboardId, 'grant');
  return listUserOptions(actor);
}

async function grantToUser(actor: Actor, rawDashboardId: unknown, userId: number, rawLevel: string) {
  const level = requireLevel(rawLevel);
  const target = await requireUserInScope(actor, userId);
  const { dashboardId } = await resolveGrantTarget(actor, target.company_id, rawDashboardId);
  const authority = await grantAuthority(actor, dashboardId, 'grant');
  await assertSharerMayChange(actor, authority, userId, dashboardId, level);

  await accessRepository.grantUser(userId, dashboardId, level, actor.id);
  audit(EVENTS.ACCESS_GRANTED, actor, {
    dashboardId,
    userId,
    targetUsername: target.username,
    companyId: target.company_id,
    level,
  });
  return { dashboardId, userId, level };
}

async function revokeFromUser(actor: Actor, rawDashboardId: unknown, userId: number) {
  const target = await requireUserInScope(actor, userId);
  const { dashboardId } = await resolveGrantTarget(actor, target.company_id, rawDashboardId);
  const authority = await grantAuthority(actor, dashboardId, 'revoke');
  await assertSharerMayChange(actor, authority, userId, dashboardId, null);

  if (!(await accessRepository.revokeUser(userId, dashboardId))) {
    throw fail('RESOURCE_NOT_FOUND', 'That account holds no direct grant on this dashboard.');
  }

  audit(EVENTS.ACCESS_REVOKED, actor, {
    dashboardId,
    userId,
    targetUsername: target.username,
    companyId: target.company_id,
  });
  return { dashboardId, userId, revoked: true };
}

async function grantToGroup(actor: Actor, rawDashboardId: unknown, groupId: number, rawLevel: string) {
  const level = requireLevel(rawLevel);
  const group = await requireGroupInScope(actor, groupId);
  const { dashboardId } = await resolveGrantTarget(actor, group.companyId, rawDashboardId);

  await accessRepository.grantGroup(groupId, dashboardId, level, actor.id);
  audit(EVENTS.ACCESS_GRANTED, actor, {
    dashboardId,
    groupId,
    groupName: group.name,
    companyId: group.companyId,
    level,
  });
  return { dashboardId, groupId, level };
}

async function revokeFromGroup(actor: Actor, rawDashboardId: unknown, groupId: number) {
  const group = await requireGroupInScope(actor, groupId);
  const { dashboardId } = await resolveGrantTarget(actor, group.companyId, rawDashboardId);

  if (!(await accessRepository.revokeGroup(groupId, dashboardId))) {
    throw fail('RESOURCE_NOT_FOUND', 'That group holds no grant on this dashboard.');
  }

  audit(EVENTS.ACCESS_REVOKED, actor, {
    dashboardId,
    groupId,
    groupName: group.name,
    companyId: group.companyId,
  });
  return { dashboardId, groupId, revoked: true };
}

async function groupDashboards(actor: Actor, groupId: number) {
  const group = await requireGroupInScope(actor, groupId);
  const [assigned, rows] = await Promise.all([
    listCompanyDashboards(group.companyId),
    accessRepository.groupGrantLevels(group.id),
  ]);
  const levels = new Map(rows.map((r: Record<string, any>) => [r.dashboard_id, r.access_level]));

  return {
    available: assigned.map((d: DashboardRecord) => ({ id: d.id, title: d.title })),
    held: assigned
      .filter((d: DashboardRecord) => levels.has(d.id))
      .map((d: DashboardRecord) => ({ id: d.id, title: d.title, level: levels.get(d.id) })),
  };
}

const companyDashboardIds = accessRepository.companyDashboardIds;

export {
  companyDashboardIds,
  listAssignableDashboards,
  assignDashboard,
  unassignDashboard,
  getAccessLevel,
  assertDashboardLevel,
  listAccessibleDashboards,
  countAccessibleDashboards,
  listUserGrants,
  describeLevels,
  grantableDashboards,
  dashboardGrants,
  shareablePeople,
  grantToUser,
  revokeFromUser,
  grantToGroup,
  revokeFromGroup,
  groupDashboards,
};
