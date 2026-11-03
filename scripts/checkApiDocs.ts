import fs from 'node:fs';
import path from 'node:path';
import { BACKEND_ROOT, OPENAPI_FILE } from '../src/config/env';

const ENTRY_FILE = path.join(BACKEND_ROOT, 'src', 'routes.ts');
const API_PREFIX = '/api';
const UNDOCUMENTED_MOUNTS = new Set([`${API_PREFIX}/docs`]);
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface OpenApiParameter {
  in?: string;
  name?: string;
  $ref?: string;
}

interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
}

type OpenApiPathItem = Partial<Record<(typeof HTTP_METHODS)[number], OpenApiOperation>> & {
  parameters?: OpenApiParameter[];
};

interface OpenApiSpec {
  paths?: Record<string, OpenApiPathItem>;
}

const ROUTE_CALL = /router\.(get|post|put|patch|delete|use)\(\s*(['"`])([^'"`]*)\2(?:\s*,\s*([A-Za-z_$][\w$]*))?/g;
const ROUTE_IMPORT = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.{1,2}\/[^'"]+Routes)['"]/g;

function joinPath(prefix: string, route: string): string {
  const joined = `${prefix}/${route}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

function toOpenApiPath(route: string): string {
  return route.replace(/:(\w+)/g, '{$1}');
}

function routesOf(file: string, prefix: string, seen: Set<string>, out: Set<string>): void {
  if (seen.has(file)) throw new Error(`route files mount each other in a loop at ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  const imports = new Map<string, string>();
  for (const [, name, module] of source.matchAll(ROUTE_IMPORT)) {
    imports.set(name, path.resolve(path.dirname(file), `${module}.ts`));
  }

  for (const [, method, , route, handler] of source.matchAll(ROUTE_CALL)) {
    const full = joinPath(prefix, route);
    if (method !== 'use') {
      out.add(`${method.toUpperCase()} ${toOpenApiPath(full)}`);
      continue;
    }
    if (UNDOCUMENTED_MOUNTS.has(full)) continue;
    const child = handler && imports.get(handler);
    if (!child)
      throw new Error(`${path.relative(BACKEND_ROOT, file)}: cannot follow router.use('${route}', ${handler ?? '?'})`);
    routesOf(child, full, new Set([...seen, file]), out);
  }
}

function documentedOperations(spec: OpenApiSpec): { operations: Set<string>; problems: string[] } {
  const operations = new Set<string>();
  const problems: string[] = [];
  const operationIds = new Map<string, string>();
  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const key = `${method.toUpperCase()} ${route}`;
      operations.add(key);
      if (!operation.operationId) problems.push(`${key} has no operationId`);
      else if (operationIds.has(operation.operationId))
        problems.push(
          `${key} reuses operationId ${operation.operationId} from ${operationIds.get(operation.operationId)}`
        );
      else operationIds.set(operation.operationId, key);
      if (!operation.tags?.length) problems.push(`${key} has no tag`);
      for (const [, name] of route.matchAll(/\{(\w+)\}/g)) {
        const params = [...(item.parameters ?? []), ...(operation.parameters ?? [])];
        const declared =
          params.some((p) => p.in === 'path' && p.name === name) ||
          params.some((p) => typeof p.$ref === 'string' && p.$ref.endsWith(`/${name}`));
        if (!declared) problems.push(`${key} does not declare path parameter ${name}`);
      }
    }
  }
  return { operations, problems };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1]) || a.localeCompare(b));
}

function main(): void {
  const spec = JSON.parse(fs.readFileSync(OPENAPI_FILE, 'utf8'));
  const served = new Set<string>();
  routesOf(ENTRY_FILE, API_PREFIX, new Set(), served);
  const { operations: documented, problems } = documentedOperations(spec);

  const undocumented = sorted([...served].filter((op) => !documented.has(op)));
  const stale = sorted([...documented].filter((op) => !served.has(op)));

  for (const op of undocumented) console.error(`not in docs/openapi.json: ${op}`);
  for (const op of stale) console.error(`documented but not served: ${op}`);
  for (const problem of problems) console.error(`spec problem: ${problem}`);

  if (undocumented.length || stale.length || problems.length) {
    console.error(
      `\nAPI docs are out of date: ${undocumented.length} undocumented, ${stale.length} stale, ${problems.length} spec problems`
    );
    process.exit(1);
  }
  console.log(`API docs match the routes: ${served.size} operations`);
}

main();
