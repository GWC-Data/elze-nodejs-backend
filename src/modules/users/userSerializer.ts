import type { PublicUser } from '../../shared/types/account';
import type { UserListRow, UserRow } from './userRepository';

type UserSource = UserRow & { companyName?: string | null };

interface UserListItem {
  id: string;
  username: string;
  email: string;
  role: string | null;
  roleId: string | null;
  roleName: string | null;
  status: string;
  customRoleId?: string | null;
  customRoleName?: string | null;
  displayName?: string;
  lastLoginAt?: Date;
  companyName?: string;
}

const isCustom = (row: { role_kind: string | null }) => row.role_kind === 'custom';

function publicUser(row: UserSource): PublicUser;
function publicUser(row: UserSource | null | undefined): PublicUser | null;
function publicUser(row: UserSource | null | undefined): PublicUser | null {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    companyName: row.companyName ?? null,
    username: row.username,
    email: row.email,
    displayName: row.display_name || null,
    role: row.role,
    roleId: row.role_id ?? null,
    roleName: row.role_name ?? null,
    roleKind: row.role_kind ?? null,
    customRoleId: isCustom(row) ? row.role_id : null,
    customRoleName: isCustom(row) ? row.role_name : null,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

function userListItem(row: UserListRow, withCompany?: boolean): UserListItem {
  const item: UserListItem = {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    roleId: row.role_id ?? null,
    roleName: row.role_name ?? null,
    status: row.status,
  };
  if (isCustom(row)) {
    item.customRoleId = row.role_id;
    item.customRoleName = row.role_name ?? null;
  }
  if (row.display_name) item.displayName = row.display_name;
  if (row.last_login_at) item.lastLoginAt = row.last_login_at;
  if (withCompany && row.companyName) item.companyName = row.companyName;
  return item;
}

export { publicUser, userListItem };
export type { PublicUser, UserListItem, UserSource };
