import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker";
import { clearDomainData, seedPreparedChallenge } from "./fixtures";
import { adminSession, apiRequest, exchangeSession } from "./http";

interface CaptainLink {
  teamName: string;
  captainName: string;
  link: string;
}

function accessToken(link: string): string {
  return new URL(link).hash.replace("#/access/captain/", "");
}

async function captainLinks(cookie: string): Promise<CaptainLink[]> {
  const response = await worker.fetch(apiRequest("/api/admin/captain-links", cookie), env);
  expect(response.status).toBe(200);
  return ((await response.json()) as { links: CaptainLink[] }).links;
}

beforeEach(async () => {
  await clearDomainData();
  await seedPreparedChallenge();
});

describe("secret link access", () => {
  it("exchanges the admin link for an HttpOnly session without echoing the token", async () => {
    const response = await worker.fetch(
      apiRequest("/api/session/exchange", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "admin", token: env.ADMIN_ACCESS_TOKEN }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain(env.ADMIN_ACCESS_TOKEN);
    expect(await response.text()).not.toContain(env.ADMIN_ACCESS_TOKEN);

    const sessionCookie = cookie.split(";", 1)[0];
    const me = await worker.fetch(apiRequest("/api/session/me", sessionCookie), env);
    expect(await me.json()).toEqual({ session: { role: "admin" } });
  });

  it("returns a neutral response for invalid and tampered links", async () => {
    const invalidAdmin = await worker.fetch(
      apiRequest("/api/session/exchange", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "admin", token: "wrong-token" }),
      }),
      env,
    );
    expect(invalidAdmin.status).toBe(401);
    expect(await invalidAdmin.text()).not.toContain("Gargano");

    const adminCookie = await adminSession();
    const token = accessToken((await captainLinks(adminCookie))[0].link);
    const tampered = await worker.fetch(
      apiRequest("/api/session/exchange", null, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "captain", token: `${token.slice(0, -1)}x` }),
      }),
      env,
    );
    expect(tampered.status).toBe(401);
    const body = await tampered.text();
    expect(body).not.toContain("Gargano");
    expect(body).not.toContain("Team Limone");
  });

  it("reconstructs stable captain links and identifies the right captain", async () => {
    const adminCookie = await adminSession();
    const firstRead = await captainLinks(adminCookie);
    const secondRead = await captainLinks(adminCookie);
    expect(secondRead).toEqual(firstRead);
    expect(firstRead).toHaveLength(3);

    const anna = firstRead.find((link) => link.captainName === "Anna")!;
    const captainCookie = await exchangeSession("captain", accessToken(anna.link));
    const me = await worker.fetch(apiRequest("/api/session/me", captainCookie), env);

    expect(await me.json()).toMatchObject({
      session: {
        role: "captain",
        challengeName: "Gargano Koch-Challenge",
        teamName: "Team Limone",
        captainName: "Anna",
      },
    });
  });

  it("enforces the role boundary on every protected API", async () => {
    const adminCookie = await adminSession();
    const links = await captainLinks(adminCookie);
    const captainCookie = await exchangeSession("captain", accessToken(links[0].link));

    const dinner = await env.DB
      .prepare("SELECT id FROM dinners ORDER BY dinner_date LIMIT 1")
      .first<{ id: string }>();
    expect(dinner).not.toBeNull();

    const adminReads = [
      "/api/admin/challenge",
      "/api/admin/dashboard",
      "/api/admin/captain-links",
      "/api/admin/results",
    ];
    for (const path of adminReads) {
      const captainAsAdmin = await worker.fetch(apiRequest(path, captainCookie), env);
      expect(captainAsAdmin.status, path).toBe(403);
      const withoutSession = await worker.fetch(apiRequest(path), env);
      expect(withoutSession.status, path).toBe(401);
    }

    const captainMutation = await worker.fetch(
      apiRequest(`/api/admin/dinners/${dinner!.id}/open`, captainCookie, { method: "POST" }),
      env,
    );
    expect(captainMutation.status).toBe(403);
    const captainReveal = await worker.fetch(
      apiRequest("/api/admin/reveal", captainCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmMissing: false }),
      }),
      env,
    );
    expect(captainReveal.status).toBe(403);

    const captainReads = [
      "/api/captain/dashboard",
      "/api/captain/results",
      `/api/captain/dinners/${dinner!.id}/ballot`,
    ];
    for (const path of captainReads) {
      const adminAsCaptain = await worker.fetch(apiRequest(path, adminCookie), env);
      expect(adminAsCaptain.status, path).toBe(403);
      const withoutSession = await worker.fetch(apiRequest(path), env);
      expect(withoutSession.status, path).toBe(401);
    }

    const adminBallotWrite = await worker.fetch(
      apiRequest(`/api/captain/dinners/${dinner!.id}/ballot`, adminCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: [] }),
      }),
      env,
    );
    expect(adminBallotWrite.status).toBe(403);
  });

  it("rejects mutating requests from another origin", async () => {
    const adminCookie = await adminSession();
    const dinner = await env.DB
      .prepare("SELECT id FROM dinners ORDER BY dinner_date LIMIT 1")
      .first<{ id: string }>();
    const request = apiRequest(`/api/admin/dinners/${dinner!.id}/open`, adminCookie, {
      method: "POST",
    });
    request.headers.set("Origin", "https://example.invalid");

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(403);
  });
});
