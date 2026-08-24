import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker";
import { DEFAULT_CATEGORIES } from "../worker/domain/challenge-setup";
import { clearDomainData } from "./fixtures";
import { adminSession, apiRequest, exchangeSession } from "./http";

interface CreatedChallenge {
  id: string;
  name: string;
  teams: Array<{
    id: string;
    name: string;
    dinner: { id: string; date: string };
  }>;
  categories: Array<{ id: string }>;
}

interface AccessLink {
  role: "captain" | "jury";
  displayName: string;
  teamName: string | null;
  link: string;
}

function accessToken(link: AccessLink): string {
  return new URL(link.link).hash.replace(`#/access/${link.role}/`, "");
}

async function adminPost(cookie: string, path: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    apiRequest(path, cookie, {
      method: "POST",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    }),
    env,
  );
}

beforeEach(async () => {
  await clearDomainData();
});

describe("complete MVP journey", () => {
  it("runs from an empty database through three dinners to identical revealed results", async () => {
    const adminCookie = await adminSession();
    const create = await worker.fetch(
      apiRequest("/api/admin/challenge", adminCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Gargano Finale",
          teams: [
            { name: "Team Limone", captainName: "Anna", dinnerDate: "2026-08-25" },
            { name: "Team Oliva", captainName: "Ben", dinnerDate: "2026-08-27" },
            { name: "Team Pomodoro", captainName: "Carla", dinnerDate: "2026-08-29" },
          ],
          juryMembers: [{ name: "Dora" }],
          categories: DEFAULT_CATEGORIES,
        }),
      }),
      env,
    );
    expect(create.status).toBe(200);
    const challenge = ((await create.json()) as { challenge: CreatedChallenge }).challenge;
    expect(challenge.teams).toHaveLength(3);
    expect(challenge.categories).toHaveLength(5);

    const accessResponse = await worker.fetch(
      apiRequest("/api/admin/access-links", adminCookie),
      env,
    );
    const links = ((await accessResponse.json()) as { links: AccessLink[] }).links;
    expect(links).toHaveLength(4);

    const voterCookies = new Map<string, string>();
    for (const link of links) {
      voterCookies.set(link.displayName, await exchangeSession(link.role, accessToken(link)));
    }

    const dinnerScores = [5, 4, 4];
    for (const [dinnerIndex, team] of challenge.teams.entries()) {
      expect(
        (await adminPost(adminCookie, `/api/admin/dinners/${team.dinner.id}/open`)).status,
      ).toBe(200);

      const adminDashboard = await worker.fetch(
        apiRequest("/api/admin/dashboard", adminCookie),
        env,
      );
      const adminDashboardText = await adminDashboard.text();
      expect(adminDashboardText).not.toContain('"score"');
      expect(adminDashboardText).not.toContain('"ratings"');

      const ownCaptain = links.find(
        (link) => link.role === "captain" && link.teamName === team.name,
      )!;
      const ownBallot = await worker.fetch(
        apiRequest(
          `/api/voter/dinners/${team.dinner.id}/ballot`,
          voterCookies.get(ownCaptain.displayName)!,
        ),
        env,
      );
      expect(ownBallot.status).toBe(403);

      const eligible = links.filter(
        (link) => link.role === "jury" || link.teamName !== team.name,
      );
      expect(eligible).toHaveLength(3);
      for (const voter of eligible) {
        const cookie = voterCookies.get(voter.displayName)!;
        const dashboard = await worker.fetch(apiRequest("/api/voter/dashboard", cookie), env);
        const dashboardText = await dashboard.text();
        expect(dashboardText).not.toContain('"score"');
        expect(dashboardText).not.toContain('"ratings"');

        const ballotResponse = await worker.fetch(
          apiRequest(`/api/voter/dinners/${team.dinner.id}/ballot`, cookie),
          env,
        );
        expect(ballotResponse.status).toBe(200);
        const ballot = (await ballotResponse.json()) as {
          ballot: { categories: Array<{ id: string }> };
        };
        const saved = await worker.fetch(
          apiRequest(`/api/voter/dinners/${team.dinner.id}/ballot`, cookie, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ratings: ballot.ballot.categories.map((category) => ({
                categoryId: category.id,
                score: dinnerScores[dinnerIndex],
              })),
            }),
          }),
          env,
        );
        expect(saved.status).toBe(200);
      }

      expect(
        (
          await adminPost(
            adminCookie,
            `/api/admin/dinners/${team.dinner.id}/close`,
            { confirmMissing: false },
          )
        ).status,
      ).toBe(200);
    }

    const hiddenResults = await worker.fetch(
      apiRequest("/api/admin/results", adminCookie),
      env,
    );
    expect(hiddenResults.status).toBe(409);
    expect(await hiddenResults.text()).not.toContain('"score"');

    const reveal = await adminPost(adminCookie, "/api/admin/reveal", {
      confirmMissing: false,
    });
    expect(reveal.status).toBe(200);

    const adminResultsResponse = await worker.fetch(
      apiRequest("/api/admin/results", adminCookie),
      env,
    );
    expect(adminResultsResponse.status).toBe(200);
    const adminResultsText = await adminResultsResponse.text();
    const results = (JSON.parse(adminResultsText) as {
      results: {
        overall: Array<{ place: number; teamName: string; score: number }>;
      };
    }).results;
    expect(results.overall).toEqual([
      { place: 1, teamName: "Team Limone", score: 5, ratingCount: 3, expectedRatingCount: 3 },
      { place: 2, teamName: "Team Oliva", score: 4, ratingCount: 3, expectedRatingCount: 3 },
      { place: 2, teamName: "Team Pomodoro", score: 4, ratingCount: 3, expectedRatingCount: 3 },
    ]);
    expect(adminResultsText).not.toContain('"ratings"');
    expect(adminResultsText).not.toContain("Anna");
    expect(adminResultsText).not.toContain("Ben");
    expect(adminResultsText).not.toContain("Carla");
    expect(adminResultsText).not.toContain("Dora");

    for (const cookie of voterCookies.values()) {
      const voterResults = await worker.fetch(apiRequest("/api/voter/results", cookie), env);
      expect(voterResults.status).toBe(200);
      expect(await voterResults.text()).toBe(adminResultsText);
    }

    const persisted = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM ballots) AS ballots,
         (SELECT COUNT(*) FROM ratings) AS ratings`,
    ).first<{ ballots: number; ratings: number }>();
    expect(persisted).toEqual({ ballots: 9, ratings: 45 });

    const lateWrite = await worker.fetch(
      apiRequest(
        `/api/voter/dinners/${challenge.teams[0].dinner.id}/ballot`,
        voterCookies.get("Ben")!,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ratings: challenge.categories.map((category) => ({
              categoryId: category.id,
              score: 1,
            })),
          }),
        },
      ),
      env,
    );
    expect(lateWrite.status).toBe(409);
  });
});
