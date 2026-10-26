import fs from 'node:fs';
import path from 'node:path';
import config from '../../config';
import { NOT_DELETED, softDeletion } from '../../shared/db/softDelete';
import type { Prisma } from '../../generated/prisma/client';
import type { DashboardListRow, StoredDashboard } from './dashboardTypes';

const { prisma, withTransaction } = config.database;
const { DASHBOARD_DIR } = config.engine;

const DEFAULT_SPEC_PATH = path.join(DASHBOARD_DIR, 'default.json');

function readJsonFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw.replace(/^﻿/, ''));
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function specFilePath(id: string): string {
  return path.join(DASHBOARD_DIR, `${id}.json`);
}

function fileMtime(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}

function listJsonFiles(dir: string = DASHBOARD_DIR): string[] {
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
}

async function findById(id: string): Promise<StoredDashboard | null> {
  const row = await prisma.dashboard.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, companyId: true, spec: true, deletedAt: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    company_id: row.companyId,
    spec: row.spec,
    deleted: row.deletedAt !== null,
  };
}

async function existsInDb(id: string): Promise<boolean> {
  return (await prisma.dashboard.count({ where: { id } })) > 0;
}

async function rowState(id: string): Promise<'live' | 'deleted' | null> {
  const row = await prisma.dashboard.findUnique({ where: { id }, select: { deletedAt: true } });
  if (!row) return null;
  return row.deletedAt ? 'deleted' : 'live';
}

async function list(companyId?: string | null): Promise<DashboardListRow[]> {
  const where =
    companyId === undefined
      ? NOT_DELETED
      : companyId === null
        ? { companyId: null, ...NOT_DELETED }
        : { OR: [{ companyId }, { companyId: null }], ...NOT_DELETED };
  return prisma.dashboard.findMany({
    where,
    select: { id: true, title: true, description: true, companyId: true, createdBy: true },
    orderBy: { title: 'asc' },
  });
}

async function upsert({
  id,
  title,
  description,
  companyId,
  userId,
  spec,
}: {
  id: string;
  title: string;
  description?: string | null;
  companyId: string | null;
  userId: string | null;
  spec: unknown;
}): Promise<void> {
  const json = spec as Prisma.InputJsonValue;
  await prisma.dashboard.upsert({
    where: { id },
    create: {
      id,
      title,
      description: description ?? null,
      companyId,
      createdBy: userId,
      spec: json,
      updatedAt: new Date(),
    },
    update: { title, description: description ?? null, spec: json, updatedAt: new Date() },
  });
}

async function purge(id: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.dashboardUserAccess.deleteMany({ where: { dashboardId: id } });
    await tx.dashboardGroupAccess.deleteMany({ where: { dashboardId: id } });
    await tx.companyDashboard.deleteMany({ where: { dashboardId: id } });
    await tx.dashboard.deleteMany({ where: { id } });
  });
}

async function deletedIds(): Promise<Set<string>> {
  const rows = await prisma.dashboard.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

async function softDelete({
  id,
  title,
  companyId,
  spec,
  deletedBy,
}: {
  id: string;
  title: string;
  companyId: string | null;
  spec: unknown;
  deletedBy: string | null;
}): Promise<void> {
  const deletion = softDeletion(deletedBy);
  await prisma.dashboard.upsert({
    where: { id },
    create: { id, title, companyId, spec: spec as Prisma.InputJsonValue, ...deletion },
    update: deletion,
  });
}

export {
  DASHBOARD_DIR,
  DEFAULT_SPEC_PATH,
  readJsonFile,
  fileExists,
  specFilePath,
  fileMtime,
  listJsonFiles,
  findById,
  existsInDb,
  rowState,
  list,
  upsert,
  deletedIds,
  softDelete,
  purge,
};
