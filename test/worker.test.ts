import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../worker";
import { adminSession, apiRequest } from "./http";

it("reports a migrated D1 database as ready", async () => {
  const response = await worker.fetch(
    new Request("https://voting.example/api/health"),
    env,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    service: "voting",
    status: "ok",
    database: "ready",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it("returns a neutral error for unknown API routes", async () => {
  const response = await worker.fetch(
    new Request("https://voting.example/api/unknown"),
    env,
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: {
      code: "NOT_FOUND",
      message: "Diese API-Route existiert nicht.",
    },
  });
});

it("returns a safe actionable message for an unexpected server failure", async () => {
  const internalDetail = "D1_INTERNAL host=db-42 secret=do-not-expose";
  const brokenEnv: Cloudflare.Env = {
    DB: {
      prepare() {
        throw new Error(internalDetail);
      },
    } as unknown as D1Database,
    ADMIN_ACCESS_TOKEN: env.ADMIN_ACCESS_TOKEN,
    AUTH_SIGNING_SECRET: env.AUTH_SIGNING_SECRET,
    TEST_MIGRATIONS: env.TEST_MIGRATIONS,
  };
  const response = await worker.fetch(
    apiRequest("/api/admin/challenge", await adminSession()),
    brokenEnv,
  );
  const body = await response.text();

  expect(response.status).toBe(500);
  expect(JSON.parse(body)).toEqual({
    error: {
      code: "UNEXPECTED_ERROR",
      message: "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
    },
  });
  expect(body).not.toContain(internalDetail);
  expect(body).not.toContain(env.ADMIN_ACCESS_TOKEN);
  expect(body).not.toContain(env.AUTH_SIGNING_SECRET);
});
