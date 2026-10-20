import { ERROR_STATUS } from './errorCodes';

class ApiError extends Error {
  declare code: string;
  declare details: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

function fail(code: string, message: string, details?: unknown): ApiError {
  if (!ERROR_STATUS[code]) {
    throw new Error(`Unknown API error code "${code}". Add it to ERROR_STATUS in constants/errorCodes.js.`);
  }
  return new ApiError(code, message, details);
}

class CodedError extends Error {
  declare code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

class FilterResolutionError extends CodedError {
  constructor(message: string) {
    super('FilterResolutionError', 'INVALID_FILTER', message);
  }
}

class InvalidDashboardIdError extends CodedError {
  constructor(dashboardId: unknown) {
    super(
      'InvalidDashboardIdError',
      'INVALID_DASHBOARD_ID',
      `Invalid dashboard id ${JSON.stringify(String(dashboardId))}. ` +
        'Allowed characters: letters, digits, underscore, hyphen (max 64).'
    );
  }
}

class DashboardNotFoundError extends CodedError {
  constructor(dashboardId: unknown) {
    super('DashboardNotFoundError', 'DASHBOARD_NOT_FOUND', `Dashboard not found: ${dashboardId}`);
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) return String(err.message);
  return String(err);
}

function codeOf(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined;
}

function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}

export { fail, messageOf, codeOf, present, FilterResolutionError, InvalidDashboardIdError, DashboardNotFoundError };
export type { ApiError };
