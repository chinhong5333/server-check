import { t } from "./i18n";
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

export function setCsrfToken(value: string | null): void {
  csrfToken = value;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers
  }).catch((cause: unknown) => {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "network_error", t("Could not reach the server. Check your connection and try again."));
  });

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null;
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ? t(error.message) : t("Request failed with HTTP {0}.", response.status),
      error?.details
    );
  }
  return payload as T;
}
