type Row = Record<string, any>;

interface UserListItem {
  id: any;
  username: any;
  email: any;
  role: any;
  status: any;
  customRoleId?: any;
  customRoleName?: any;
  displayName?: any;
  lastLoginAt?: any;
  companyName?: any;
}

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
    customRoleId: row.custom_role_id ?? null,
    customRoleName: row.customRoleName ?? null,
    status: row.status,
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
  };
}

function userListItem(row: Row, withCompany?: boolean): UserListItem {
  const item: UserListItem = { id: row.id, username: row.username, email: row.email, role: row.role, status: row.status };
  if (row.custom_role_id) {
    item.customRoleId = row.custom_role_id;
    item.customRoleName = row.customRoleName ?? null;
  }
  if (row.display_name) item.displayName = row.display_name;
  if (row.last_login_at) item.lastLoginAt = row.last_login_at;
  if (withCompany && row.companyName) item.companyName = row.companyName;
  return item;
}

export { publicUser, userListItem };
export type { UserListItem };
