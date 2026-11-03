interface Actor {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  role: string;
  roleScope: string;
  isPlatform: boolean;
  companyId: string | null;
  status: string;
  mustChangePassword: boolean;
  permissions: readonly string[];
  features: readonly string[];
  roleId: string | null;
  roleName: string | null;
  scopes?: Record<string, unknown[]>;
  familyId?: string;
}

export type { Actor };
