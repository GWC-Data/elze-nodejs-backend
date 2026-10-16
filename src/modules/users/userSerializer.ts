type Row = Record<string, any>;

interface UserListItem {
  id: any;
  username: any;
  email: any;
  role: any;
  roleId: any;
  roleName: any;
  status: any;
  customRoleId?: any;
  customRoleName?: any;
  displayName?: any;
  lastLoginAt?: any;
  companyName?: any;
}

const isCustom = (row: Row) => row.role_kind === 'custom';

function publicUser(row: Row | null | undefined) {
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

function userListItem(row: Row, withCompany?: boolean): UserListItem {
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
export type { UserListItem };
