import config from '../config';
import * as companyRepository from '../repositories/companyRepository';
import * as userRepository from '../repositories/userRepository';
import { fail } from '../tools/AppError';
import { slugify } from '../tools/slugify';
import { requireString } from '../validators/commonValidator';
import { shapeCompany, companyOption } from '../views/serializers/companySerializer';
import { publicUser } from '../views/serializers/userSerializer';
import { assertCanAssignRole } from './authorizationService';
import { createAccount, prepareInvitation } from './onboardingService';
import { sendEmail } from './emailService';
import { revokeAllForCompany } from './tokenService';
import { audit, EVENTS } from './auditService';
import { parseFeatureIds, setInitialFeatures } from './featureService';
import { seedForCompany } from './builtInRolesService';
import { effectiveFeatures, featureIdsOf, systemRoleId, toggleableFeatureKeys } from './catalogueService';
import { COMPANY_ADMIN } from '../constants/roles';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import { sqlState } from '../tools/dbError';
import type { Actor } from '../types/actor';
import type { Tx } from '../config/database';
import type { ListWindow } from '../repositories/baseRepository';

const { withTransaction } = config.database;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

async function listCompanies(actor: Actor, list: ListWindow, { active }: { active?: unknown } = {}) {
  const filter: companyRepository.CompanyFilter = {};
  if (!actor.isPlatform) filter.companyId = actor.companyId as number;
  if (active === 'true' || active === 'false') {
    filter.active = active === 'true';
  } else if (active !== undefined && active !== '') {
    throw fail('VALIDATION_ERROR', 'active must be true or false.');
  }
  if (list.search) filter.search = list.search;
  return companyRepository.listPage(filter, list, shapeCompany);
}

async function listCompanyOptions(actor: Actor) {
  const rows = await companyRepository.listOptions(actor.isPlatform ? null : actor.companyId);
  return rows.map(companyOption);
}

async function requireCompany(actor: Actor, id: number, { counts = false }: { counts?: boolean } = {}) {
  if (!actor.isPlatform && id !== actor.companyId) {
    throw fail('TENANT_ACCESS_DENIED', 'That company is not yours to view.');
  }
  const row = counts ? await companyRepository.findWithCounts(id) : await companyRepository.findRow(id);
  const company = shapeCompany(row);
  if (!company) throw fail('RESOURCE_NOT_FOUND', 'Company not found');
  return company;
}

async function requireActiveCompany(actor: Actor, id: number, message: string) {
  const company = await requireCompany(actor, id);
  if (!company.active) throw fail('VALIDATION_ERROR', message);
  return company;
}

async function insertCompany(actor: Actor, { name, slug }: { name: unknown; slug?: unknown }, conn?: Tx) {
  const cleanName = requireString(name, 'Company name', { max: 150, min: 2 });
  const cleanSlug = slug ? String(slug).trim().toLowerCase() : slugify(cleanName);

  if (!SLUG_RE.test(cleanSlug)) {
    throw fail(
      'VALIDATION_ERROR',
      'Company slug must be 3-64 characters of lowercase letters, digits and hyphens, and cannot start or end with a hyphen.'
    );
  }

  try {
    return await companyRepository.insert({ name: cleanName, slug: cleanSlug, createdBy: actor.id }, conn);
  } catch (err: any) {
    if (sqlState(err) === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', 'A company with that name or slug already exists.');
    }
    throw err;
  }
}

async function createCompany(
  actor: Actor,
  { name, slug, admin, featureIds }: { name: unknown; slug?: unknown; admin?: any; featureIds?: unknown }
) {
  if (!admin || typeof admin !== 'object') {
    throw fail(
      'VALIDATION_ERROR',
      "A company needs an administrator. Send an 'admin' object with a username and an email address."
    );
  }

  assertCanAssignRole(actor, COMPANY_ADMIN);

  const featureKeys = featureIds === undefined ? toggleableFeatureKeys() : parseFeatureIds(featureIds);

  const { company, user, invitation } = await withTransaction(async (conn: Tx) => {
    const companyRow = await insertCompany(actor, { name, slug }, conn);
    await setInitialFeatures(actor, companyRow.id, featureKeys, conn);
    await seedForCompany(companyRow.id, conn);
    const userRow = await createAccount(
      {
        companyId: companyRow.id,
        username: admin.username,
        email: admin.email,
        displayName: admin.displayName,
        role: COMPANY_ADMIN,
        roleId: systemRoleId(COMPANY_ADMIN),
      },
      conn
    );
    return {
      company: companyRow,
      user: userRow,
      invitation: await prepareInvitation(actor, userRow, { conn }),
    };
  });

  try {
    await sendEmail(invitation, {
      consequence: 'The company and its administrator were not created.',
    });
  } catch (err) {
    await companyRepository.remove(company.id);
    throw err;
  }

  audit(EVENTS.COMPANY_CREATED, actor, {
    companyId: company.id,
    name: company.name,
    features: effectiveFeatures(featureKeys),
    featureIds: featureIdsOf(effectiveFeatures(featureKeys)),
  });
  audit(EVENTS.USER_CREATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    targetEmail: user.email,
    role: user.role,
    roleId: systemRoleId(COMPANY_ADMIN),
    companyId: company.id,
  });

  return { ...shapeCompany(company), features: effectiveFeatures(featureKeys), admin: publicUser(user) };
}

async function updateCompany(actor: Actor, id: number, { name, active }: { name?: unknown; active?: unknown }) {
  const before = await requireCompany(actor, id);

  const changes: { name?: string; active?: boolean } = {};
  if (name !== undefined) changes.name = requireString(name, 'Company name', { max: 150, min: 2 });
  if (typeof active === 'boolean') changes.active = active;
  if (!Object.keys(changes).length) throw fail('VALIDATION_ERROR', 'Nothing to update');

  try {
    await companyRepository.updateColumns(id, changes);
  } catch (err: any) {
    if (sqlState(err) === UNIQUE_VIOLATION) throw fail('CONFLICT', 'A company with that name already exists.');
    throw err;
  }
  const company = shapeCompany(await companyRepository.findWithCounts(id))!;

  if (before.active && company.active === false) {
    await revokeAllForCompany(id, 'company_disabled');
  }

  audit(EVENTS.COMPANY_UPDATED, actor, {
    companyId: id,
    name: company.name,
    activeChanged: before.active !== company.active,
    active: company.active,
  });
  return company;
}

async function deleteCompany(actor: Actor, id: number): Promise<void> {
  const company = await requireCompany(actor, id);
  const n = await userRepository.countByCompany(id);
  if (n > 0) {
    throw fail(
      'CONFLICT',
      `This company still has ${n} account${n === 1 ? '' : 's'}. Delete them first.`
    );
  }
  if (!(await companyRepository.remove(id))) throw fail('RESOURCE_NOT_FOUND', 'Company not found');
  audit(EVENTS.COMPANY_DELETED, actor, { companyId: id, name: company.name });
}

const COMPANY_SORTS = companyRepository.COMPANY_SORTS;

export {
  COMPANY_SORTS,
  listCompanies,
  listCompanyOptions,
  requireCompany,
  requireActiveCompany,
  createCompany,
  updateCompany,
  deleteCompany,
};
