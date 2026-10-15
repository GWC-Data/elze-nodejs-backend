const SUPER_ADMIN = 'SUPER_ADMIN';
const COMPANY_ADMIN = 'COMPANY_ADMIN';
const USER = 'USER';

const ROLE_TIERS = [SUPER_ADMIN, COMPANY_ADMIN, USER] as const;
type RoleTier = (typeof ROLE_TIERS)[number];

const ROLE_SCOPES = { platform: 'platform', company: 'company' };

function scopeOfTier(tier: unknown): string | undefined {
  if (tier === SUPER_ADMIN) return ROLE_SCOPES.platform;
  if (tier === COMPANY_ADMIN || tier === USER) return ROLE_SCOPES.company;
  return undefined;
}

export { SUPER_ADMIN, COMPANY_ADMIN, USER, ROLE_TIERS, ROLE_SCOPES, scopeOfTier };
export type { RoleTier };
