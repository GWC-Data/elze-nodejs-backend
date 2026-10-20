import fs from 'node:fs';
import path from 'node:path';
import config from '../../config';
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
    select: { id: true, title: true, description: true, companyId: true, spec: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    company_id: row.companyId,
    spec: row.spec,
  };
}

async function existsInDb(id: string): Promise<boolean> {
  return (await prisma.dashboard.count({ where: { id } })) > 0;
}

async function list(companyId?: number | null): Promise<DashboardListRow[]> {
  const where =
    companyId === undefined
      ? {}
      : companyId === null
        ? { companyId: null }
        : { OR: [{ companyId }, { companyId: null }] };
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
  companyId: number | null;
  userId: number | null;
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

async function removeWithGrants(id: string): Promise<void> {
  await withTransaction(async (tx) => {
    await tx.dashboardUserAccess.deleteMany({ where: { dashboardId: id } });
    await tx.dashboardGroupAccess.deleteMany({ where: { dashboardId: id } });
    await tx.companyDashboard.deleteMany({ where: { dashboardId: id } });
    await tx.dashboard.deleteMany({ where: { id } });
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
  list,
  upsert,
  removeWithGrants,
};
