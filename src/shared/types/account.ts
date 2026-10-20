interface PublicUser {
  id: number;
  companyId: number | null;
  companyName: string | null;
  username: string;
  email: string;
  displayName: string | null;
  role: string | null;
  roleId: string | null;
  roleName: string | null;
  roleKind: string | null;
  customRoleId: string | null;
  customRoleName: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date | null;
}

export type { PublicUser };
