// The signed-in account as the request sees it: built by buildActor() in
// services/authorization.service, then given scopes and familyId by requireAuth.
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
  // Already masked by the company's features (constants/features.ts): a permission whose
  // feature is off is not in this list, whatever the role holds.
  permissions: readonly string[];
  // The company's enabled features, locked ones included. Every feature for the platform.
  features: readonly string[];
  customRoleId: number | null;
  scopes?: any;
  familyId?: string;
}

export type { Actor };
