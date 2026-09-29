export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 'NETWORK', 0);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as (T & ErrorEnvelope) | null;
  if (!response.ok) {
    const envelope = body?.error;
    throw new ApiError(
      envelope?.message ?? `Request failed with status ${response.status}.`,
      envelope?.code ?? 'REQUEST_ERROR',
      response.status,
      envelope?.details,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) }),
  patch: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export function formatValidationDetails(details: unknown): string[] {
  if (
    details &&
    typeof details === 'object' &&
    Array.isArray((details as { issues?: unknown }).issues)
  ) {
    return ((details as { issues: Array<{ path: string; message: string }> }).issues).map(
      (issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message),
    );
  }
  return [];
}

export function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

export function formatInterval(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)} min`;
  }
  if (seconds < 86400) {
    const hours = seconds / 3600;
    return Number.isInteger(hours) ? `${hours} h` : `${hours.toFixed(1)} h`;
  }
  return `${seconds / 86400} day(s)`;
}
