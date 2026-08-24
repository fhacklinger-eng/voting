import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import worker from "../worker";

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
