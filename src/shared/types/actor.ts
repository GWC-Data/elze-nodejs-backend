interface Actor {
  id: number;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  roleScope: string;
  isPlatform: boolean;
  companyId: number | null;
  status: string;
  mustChangePassword: boolean;
  permissions: readonly string[];
  features: readonly string[];
  roleId: string | null;
  roleName: string | null;
  scopes?: any;
  familyId?: string;
}

export type { Actor };
