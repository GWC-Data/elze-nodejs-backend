import config from '../config';
import * as companyRepository from '../repositories/company.repository';
import * as userRepository from '../repositories/user.repository';
import { fail } from '../tools/AppError';
import { likePattern } from '../tools/listQuery';
import { slugify } from '../tools/slugify';
import { requireString } from '../validators/common.validator';
import { shapeCompany, companyOption } from '../views/serializers/company.serializer';
import { publicUser } from '../views/serializers/user.serializer';
import { assertCanAssignRole } from './authorization.service';
import { createAccount, prepareInvitation } from './onboarding.service';
import { sendEmail } from './email.service';
import { revokeAllForCompany } from './token.service';
import { audit, EVENTS } from './audit.service';
import { parseFeatureList, setInitialFeatures } from './feature.service';
import { seedForCompany } from './builtInRoles.service';
import { TOGGLEABLE_FEATURE_IDS, effectiveFeatures } from '../constants/features';
import { COMPANY_ADMIN } from '../constants/permissions';
import { UNIQUE_VIOLATION } from '../constants/pgErrors';
import type { Actor } from '../types/actor';
import type { Queryable } from '../config/pgPool';
import type { ListWindow } from '../repositories/base.repository';

const { withTransaction } = config.database;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

async function listCompanies(actor: Actor, list: ListWindow, { active }: { active?: unknown } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!actor.isPlatform) {
    where.push('c.id = ?');
    params.push(actor.companyId);
  }
  if (active === 'true' || active === 'false') {
    where.push('c.active = ?');
    params.push(active === 'true');
  } else if (active !== undefined && active !== '') {
    throw fail('VALIDATION_ERROR', 'active must be true or false.');
  }
  if (list.search) {
    where.push('(c.name ILIKE ? OR c.slug ILIKE ?)');
    const pattern = likePattern(list.search);
    params.push(pattern, pattern);
  }
  return companyRepository.listPage(where, params, list, shapeCompany);
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

async function insertCompany(actor: Actor, { name, slug }: { name: unknown; slug?: unknown }, conn?: Queryable) {
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
    if (err.code === UNIQUE_VIOLATION) {
      throw fail('CONFLICT', 'A company with that name or slug already exists.');
    }
    throw err;
  }
}

async function createCompany(
  actor: Actor,
  { name, slug, admin, features }: { name: unknown; slug?: unknown; admin?: any; features?: unknown }
) {
  if (!admin || typeof admin !== 'object') {
    throw fail(
      'VALIDATION_ERROR',
      "A company needs an administrator. Send an 'admin' object with a username and an email address."
    );
  }

  assertCanAssignRole(actor, COMPANY_ADMIN);

  // Omitted = every feature, so an API client written before toggles keeps working;
  // the console always sends the list. [] = Metadata Lakehouse only.
  const featureIds = features === undefined ? [...TOGGLEABLE_FEATURE_IDS] : parseFeatureList(features);

  const { company, user, invitation } = await withTransaction(async (conn: Queryable) => {
    const companyRow = await insertCompany(actor, { name, slug }, conn);
    await setInitialFeatures(actor, companyRow.id, featureIds, conn);
    // The company's own Member role, a copy of the current defaults - same transaction, so a
    // company never exists without it.
    await seedForCompany(companyRow.id, conn);
    const userRow = await createAccount(
      {
        companyId: companyRow.id,
        username: admin.username,
        email: admin.email,
        displayName: admin.displayName,
        role: COMPANY_ADMIN,
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
    features: effectiveFeatures(featureIds),
  });
  audit(EVENTS.USER_CREATED, actor, {
    userId: user.id,
    targetUsername: user.username,
    targetEmail: user.email,
    role: user.role,
    companyId: company.id,
  });

  return { ...shapeCompany(company), features: effectiveFeatures(featureIds), admin: publicUser(user) };
}

async function updateCompany(actor: Actor, id: number, { name, active }: { name?: unknown; active?: unknown }) {
  const before = await requireCompany(actor, id);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) {
    updates.push('name = ?');
    params.push(requireString(name, 'Company name', { max: 150, min: 2 }));
  }
  if (typeof active === 'boolean') {
    updates.push('active = ?');
    params.push(active);
  }
  if (!updates.length) throw fail('VALIDATION_ERROR', 'Nothing to update');

  try {
    await companyRepository.updateColumns(id, updates, params);
  } catch (err: any) {
    if (err.code === UNIQUE_VIOLATION) throw fail('CONFLICT', 'A company with that name already exists.');
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
