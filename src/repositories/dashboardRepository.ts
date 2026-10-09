import fs from 'fs';
import path from 'path';
import config from '../config';
import { T } from '../models/rbacModel';
import type { Queryable } from '../config/pgPool';

const { db, withTransaction } = config.database;
const { DASHBOARD_DIR } = config.engine;

const DEFAULT_SPEC_PATH = path.join(DASHBOARD_DIR, 'default.json');

function readJsonFile(filePath: string): any {
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

async function findById(id: string) {
  const { rows } = await db.query(
    `SELECT id, title, description, company_id, spec FROM ${T.dashboards} WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function existsInDb(id: string): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM ${T.dashboards} WHERE id = ?`, [id]);
  return rows.length > 0;
}

async function list(companyId?: number | null) {
  let sql = `SELECT id, title, description, company_id AS "companyId", created_by AS "createdBy"
               FROM ${T.dashboards}`;
  const params: unknown[] = [];
  if (companyId !== undefined) {
    if (companyId === null) {
      sql += ' WHERE company_id IS NULL';
    } else {
      sql += ' WHERE company_id = ? OR company_id IS NULL';
      params.push(companyId);
    }
  }
  sql += ' ORDER BY title ASC';
  const { rows } = await db.query(sql, params);
  return rows;
}

async function upsert({ id, title, description, companyId, userId, spec }: {
  id: string;
  title: string;
  description?: string | null;
  companyId: number | null;
  userId: number | null;
  spec: unknown;
}): Promise<void> {
  await db.query(
    `INSERT INTO ${T.dashboards} (id, title, description, company_id, created_by, spec, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, now())
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       spec = EXCLUDED.spec,
       updated_at = now()`,
    [id, title, description, companyId, userId, JSON.stringify(spec)]
  );
}

async function removeWithGrants(id: string): Promise<void> {
  await withTransaction(async (conn: Queryable) => {
    await conn.query(`DELETE FROM ${T.dashboardAccess} WHERE dashboard_id = ?`, [id]);
    await conn.query(`DELETE FROM ${T.groupDashboardAccess} WHERE dashboard_id = ?`, [id]);
    await conn.query(`DELETE FROM ${T.companyDashboards} WHERE dashboard_id = ?`, [id]);
    await conn.query(`DELETE FROM ${T.dashboards} WHERE id = ?`, [id]);
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
