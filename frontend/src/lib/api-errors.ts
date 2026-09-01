export interface ApiErrorBody {
  code?: string;
  message?: string;
  used?: number;
  limit?: number;
  tier?: string;
  resets_at?: string;
}

export class ApiError extends Error {
  status: number;
  path: string;
  body: ApiErrorBody | null;

  constructor(status: number, path: string, body: ApiErrorBody | null, fallbackText: string) {
    super(body?.message ?? fallbackText);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.body = body;
  }

  get code(): string | undefined {
    return this.body?.code;
  }
}

export function parseApiErrorText(text: string): ApiErrorBody | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && "detail" in (parsed as object)) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === "string") return { message: detail };
      if (detail && typeof detail === "object") return detail as ApiErrorBody;
    }
    if (parsed && typeof parsed === "object") return parsed as ApiErrorBody;
  } catch {
    // plain text
  }
  return null;
}

/** User-friendly console / toast message for common API failures. */
export function friendlyApiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "run_limit_exceeded") {
      return (
        error.message ||
        `You've used all ${error.body?.limit ?? "?"} code runs for today. Upgrade to Pro for more, or try again after midnight UTC.`
      );
    }
    if (error.code === "snippet_publish_limit_exceeded") {
      return (
        error.message ||
        "Monthly snippet publish limit reached. Upgrade to Pro to publish more snippets."
      );
    }
    return error.message;
  }
  return String(error);
}
