import { env } from "cloudflare:workers";
import worker from "../worker";

export const TEST_ORIGIN = "https://voting.example";

export function apiRequest(
  path: string,
  cookie: string | null = null,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("Origin", TEST_ORIGIN);
  }
  return new Request(`${TEST_ORIGIN}${path}`, { ...init, headers });
}

export async function exchangeSession(kind: "admin" | "captain" | "jury", token: string): Promise<string> {
  const response = await worker.fetch(
    apiRequest("/api/session/exchange", null, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, token }),
    }),
    env,
  );
  if (!response.ok) {
    throw new Error(`Session exchange failed with ${response.status}: ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Session exchange did not set a cookie");
  return cookie;
}

export function adminSession(): Promise<string> {
  return exchangeSession("admin", env.ADMIN_ACCESS_TOKEN);
}
