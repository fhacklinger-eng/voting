import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker";
import { densePlaces, roundScoreToHundredths } from "../worker/persistence/results";
import { clearDomainData, seedPreparedChallenge } from "./fixtures";
import { adminSession, apiRequest, exchangeSession } from "./http";

interface CaptainLink {
  captainName: string;
  link: string;
}

let seeded: Awaited<ReturnType<typeof seedPreparedChallenge>>;
let adminCookie: string;

function captainToken(link: string): string {
  return new URL(link).hash.replace("#/access/captain/", "");
}

async function captainCookie(name: string): Promise<string> {
  const response = await worker.fetch(
    apiRequest("/api/admin/captain-links", adminCookie),
    env,
  );
  const links = ((await response.json()) as { links: CaptainLink[] }).links;
  return exchangeSession(
    "captain",
    captainToken(links.find((link) => link.captainName === name)!.link),
  );
}

async function reveal(confirmMissing: boolean): Promise<Response> {
  return worker.fetch(
    apiRequest("/api/admin/reveal", adminCookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmMissing }),
    }),
    env,
  );
}

async function closeAllDinners(): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare("UPDATE challenges SET status = 'running' WHERE id = ?")
      .bind(seeded.challengeId),
    env.DB
      .prepare("UPDATE dinners SET status = 'closed', closed_at = ? WHERE challenge_id = ?")
      .bind("2026-08-30T12:00:00.000Z", seeded.challengeId),
  ]);
}

async function insertBallot(
  dinnerId: string,
  captainTeamId: string,
  scores: [number, number, number, number, number],
): Promise<void> {
  const id = `result-ballot:${dinnerId}:${captainTeamId}`;
  const now = "2026-08-30T10:00:00.000Z";
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO ballots (
           id, challenge_id, dinner_id, captain_team_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, seeded.challengeId, dinnerId, captainTeamId, now, now),
    ...scores.map((score, index) =>
      env.DB
        .prepare(
          "INSERT INTO ratings (ballot_id, category_id, challenge_id, score) VALUES (?, ?, ?, ?)",
        )
        .bind(id, `prepared-category-${index + 1}`, seeded.challengeId, score),
    ),
  ]);
}

async function seedResultBallots(): Promise<void> {
  await Promise.all([
    insertBallot(seeded.dinnerIds[0], seeded.teamIds[1], [5, 4, 3, 2, 1]),
    insertBallot(seeded.dinnerIds[0], seeded.teamIds[2], [4, 4, 3, 3, 2]),
    insertBallot(seeded.dinnerIds[1], seeded.teamIds[0], [4, 4, 4, 4, 4]),
    // A legacy/corrupt self ballot must never influence a valid foreign result.
    insertBallot(seeded.dinnerIds[1], seeded.teamIds[1], [1, 1, 1, 1, 1]),
    insertBallot(seeded.dinnerIds[2], seeded.teamIds[0], [5, 4, 4, 3, 2]),
    insertBallot(seeded.dinnerIds[2], seeded.teamIds[1], [3, 4, 4, 5, 4]),
  ]);
}

beforeEach(async () => {
  await clearDomainData();
  seeded = await seedPreparedChallenge();
  adminCookie = await adminSession();
});

describe("result reveal", () => {
  it("does not expose results early and blocks ineligible reveals", async () => {
    const benCookie = await captainCookie("Ben");
    const adminResults = await worker.fetch(apiRequest("/api/admin/results", adminCookie), env);
    const captainResults = await worker.fetch(apiRequest("/api/captain/results", benCookie), env);
    expect(adminResults.status).toBe(409);
    expect(captainResults.status).toBe(409);
    expect(await adminResults.text()).not.toContain("Team Limone");
    expect(await captainResults.text()).not.toContain("Team Limone");

    const dinnersOpen = await reveal(false);
    expect(dinnersOpen.status).toBe(409);
    expect(await dinnersOpen.json()).toMatchObject({
      error: { code: "DINNERS_NOT_CLOSED" },
    });

    await closeAllDinners();
    const noVotes = await reveal(false);
    expect(noVotes.status).toBe(409);
    expect(await noVotes.json()).toMatchObject({
      error: {
        code: "TEAM_WITHOUT_VOTES",
        blockedTeams: ["Team Limone", "Team Oliva", "Team Pomodoro"],
      },
    });
  });

  it("confirms concrete gaps and returns identical deterministic rankings", async () => {
    await closeAllDinners();
    await seedResultBallots();
    const benCookie = await captainCookie("Ben");

    const confirmation = await reveal(false);
    expect(confirmation.status).toBe(409);
    expect(await confirmation.json()).toMatchObject({
      error: {
        code: "MISSING_VOTES_CONFIRMATION_REQUIRED",
        missingVotes: [
          {
            captainName: "Carla",
            captainTeamName: "Team Pomodoro",
            dinnerTeamName: "Team Oliva",
            dinnerDate: "2026-08-27",
          },
        ],
      },
    });

    const revealed = await reveal(true);
    expect(revealed.status).toBe(200);
    const challenge = await env.DB
      .prepare("SELECT status, revealed_at FROM challenges WHERE id = ?")
      .bind(seeded.challengeId)
      .first<{ status: string; revealed_at: string | null }>();
    expect(challenge?.status).toBe("revealed");
    expect(challenge?.revealed_at).not.toBeNull();

    const adminResponse = await worker.fetch(apiRequest("/api/admin/results", adminCookie), env);
    const captainResponse = await worker.fetch(apiRequest("/api/captain/results", benCookie), env);
    expect(adminResponse.status).toBe(200);
    expect(captainResponse.status).toBe(200);
    const adminBody = await adminResponse.text();
    const captainBody = await captainResponse.text();
    expect(JSON.parse(captainBody)).toEqual(JSON.parse(adminBody));
    expect(adminBody).not.toContain("captainName");
    expect(adminBody).not.toContain('"ratings"');
    expect(adminBody).not.toContain("Anna");
    expect(adminBody).not.toContain("Ben");
    expect(adminBody).not.toContain("Carla");

    const results = (JSON.parse(adminBody) as {
      results: {
        categories: Array<{
          ranking: Array<{
            place: number;
            teamName: string;
            score: number;
            ratingCount: number;
            expectedRatingCount: number;
          }>;
        }>;
        overall: Array<{
          place: number;
          teamName: string;
          score: number;
          ratingCount: number;
          expectedRatingCount: number;
        }>;
      };
    }).results;

    expect(results.categories[0].ranking).toEqual([
      expect.objectContaining({ place: 1, teamName: "Team Limone", score: 4.5 }),
      expect.objectContaining({ place: 2, teamName: "Team Oliva", score: 4 }),
      expect.objectContaining({ place: 2, teamName: "Team Pomodoro", score: 4 }),
    ]);
    expect(results.categories[1].ranking.map((team) => team.place)).toEqual([1, 1, 1]);
    expect(results.overall).toEqual([
      expect.objectContaining({
        place: 1,
        teamName: "Team Oliva",
        score: 4,
        ratingCount: 1,
        expectedRatingCount: 2,
      }),
      expect.objectContaining({ place: 2, teamName: "Team Pomodoro", score: 3.8 }),
      expect.objectContaining({ place: 3, teamName: "Team Limone", score: 3.1 }),
    ]);

    const repeated = await worker.fetch(apiRequest("/api/admin/results", adminCookie), env);
    expect(await repeated.text()).toBe(adminBody);
  });

  it("locks configuration, dinner states and ratings after reveal", async () => {
    await closeAllDinners();
    await seedResultBallots();
    const benCookie = await captainCookie("Ben");
    expect((await reveal(true)).status).toBe(200);

    const configurationResponse = await worker.fetch(
      apiRequest("/api/admin/challenge", adminCookie),
      env,
    );
    const configuration = (await configurationResponse.json()) as {
      challenge: {
        name: string;
        teams: Array<{
          id: string;
          name: string;
          captainName: string;
          dinner: { date: string };
        }>;
        categories: Array<{ id: string; name: string; question: string }>;
      };
    };
    const update = await worker.fetch(
      apiRequest("/api/admin/challenge", adminCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${configuration.challenge.name} geändert`,
          teams: configuration.challenge.teams.map((team) => ({
            id: team.id,
            name: team.name,
            captainName: team.captainName,
            dinnerDate: team.dinner.date,
          })),
          categories: configuration.challenge.categories,
        }),
      }),
      env,
    );
    expect(update.status).toBe(409);

    const reopen = await worker.fetch(
      apiRequest(`/api/admin/dinners/${seeded.dinnerIds[0]}/reopen`, adminCookie, {
        method: "POST",
      }),
      env,
    );
    expect(reopen.status).toBe(409);

    const ballot = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratings: [1, 2, 3, 4, 5].map((score, index) => ({
            categoryId: `prepared-category-${index + 1}`,
            score,
          })),
        }),
      }),
      env,
    );
    expect(ballot.status).toBe(409);
  });
});

describe("result math", () => {
  it("rounds commercially and assigns dense places", () => {
    expect(roundScoreToHundredths(1005, 1000)).toBe(101);
    expect(roundScoreToHundredths(2, 3)).toBe(67);
    expect(roundScoreToHundredths(1, 8)).toBe(13);
    expect(densePlaces([450, 450, 400, 350, 350])).toEqual([1, 1, 2, 3, 3]);
  });
});
