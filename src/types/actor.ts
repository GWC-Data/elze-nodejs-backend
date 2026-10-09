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
  customRoleId: number | null;
  scopes?: any;
  familyId?: string;
}

export type { Actor };
