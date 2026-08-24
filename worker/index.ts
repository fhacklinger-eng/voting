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

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return health(env);
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
