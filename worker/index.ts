const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

async function health(env: Cloudflare.Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT COUNT(*) AS count FROM challenges").first();
    return json({ service: "voting", status: "ok", database: "ready" });
  } catch {
    return json(
      {
        error: {
          code: "DATABASE_NOT_READY",
          message: "Die Datenbank ist noch nicht eingerichtet.",
        },
      },
      { status: 503 },
    );
  }
}

class InvalidJsonError extends Error {}

async function parseJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new InvalidJsonError("JSON_REQUIRED");
  }

  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError("INVALID_JSON");
  }
}

async function adminChallenge(request: Request, env: Cloudflare.Env): Promise<Response> {
  if (request.method === "GET") {
    return json({ challenge: await readChallengeConfiguration(env.DB) });
  }

  if (request.method !== "PUT") {
    return json(
      {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Diese Aktion wird nicht unterstützt.",
        },
      },
      { status: 405, headers: { Allow: "GET, PUT" } },
    );
  }

  try {
    const challenge = await saveChallengeConfiguration(env.DB, await parseJson(request));
    return json({ challenge });
  } catch (error) {
    if (error instanceof ConfigurationValidationError) {
      return json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: error.message,
            fieldErrors: error.fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    if (error instanceof ConfigurationConflictError) {
      return json(
        { error: { code: error.code, message: error.message } },
        { status: 409 },
      );
    }
    if (error instanceof InvalidJsonError) {
      return json(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "Bitte sende gültige JSON-Daten.",
          },
        },
        { status: 400 },
      );
    }

    return json(
      {
        error: {
          code: "CONFIGURATION_SAVE_FAILED",
          message: "Die Challenge konnte gerade nicht gespeichert werden. Bitte versuche es erneut.",
        },
      },
      { status: 500 },
    );
  }
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return health(env);
    }

    if (url.pathname === "/api/admin/challenge") {
      return adminChallenge(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Diese API-Route existiert nicht.",
          },
        },
        { status: 404 },
      );
    }

    return new Response(null, { status: 404 });
  },
};
import { ConfigurationValidationError } from "./domain/challenge-setup";
import {
  ConfigurationConflictError,
  readChallengeConfiguration,
  saveChallengeConfiguration,
} from "./persistence/challenges";
