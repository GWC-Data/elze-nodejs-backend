import type { Prisma } from '../../generated/prisma/client';

type JsonValue = Prisma.JsonValue;
type JsonObject = Prisma.JsonObject;

type RequestBody = Record<string, unknown>;
type RequestQuery = Record<string, unknown>;

interface DatasetFields {
  id?: unknown;
  name?: unknown;
  rowCount?: unknown;
  columnCount?: unknown;
  selectedAt?: unknown;
}

interface FallbackDataset {
  id: string;
  name: string | null;
  rowCount: number | null;
  columnCount: number | null;
  selectedAt: Date | null;
}

type PublishedDataset = JsonValue | FallbackDataset;

interface DraftTarget {
  id: string;
  name: string;
  companyId: string;
  selectedDatasets?: readonly { id: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unreadable(value: unknown, key: string): TypeError {
  return new TypeError(`Cannot read properties of ${value} (reading '${key}')`);
}

function entry(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function strictEntry(value: unknown, key: string): unknown {
  if (value === null || value === undefined) throw unreadable(value, key);
  return entry(value, key);
}

function field(value: JsonValue | undefined, key: string): JsonValue | undefined {
  return isJsonObject(value) ? value[key] : undefined;
}

function strictField(value: JsonValue | undefined, key: string): JsonValue | undefined {
  if (value === null || value === undefined) throw unreadable(value, key);
  return field(value, key);
}

function jsonList(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function listOf(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function datasetFields(dataset: PublishedDataset): DatasetFields {
  return isRecord(dataset) ? dataset : {};
}

export { isRecord, isJsonObject, entry, strictEntry, field, strictField, jsonList, listOf, datasetFields };
export type {
  JsonValue,
  JsonObject,
  RequestBody,
  RequestQuery,
  DatasetFields,
  FallbackDataset,
  PublishedDataset,
  DraftTarget,
};
