import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker";
import { clearDomainData, seedPreparedChallenge } from "./fixtures";
import { adminSession, apiRequest, exchangeSession } from "./http";

interface CaptainLink {
  captainName: string;
  link: string;
}

let seeded: Awaited<ReturnType<typeof seedPreparedChallenge>>;
let adminCookie: string;

function token(link: string): string {
  return new URL(link).hash.replace("#/access/captain/", "");
}

async function postAdmin(path: string, body?: unknown): Promise<Response> {
  return worker.fetch(
    apiRequest(path, adminCookie, {
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

async function links(): Promise<CaptainLink[]> {
  const response = await worker.fetch(
    apiRequest("/api/admin/captain-links", adminCookie),
    env,
  );
  return ((await response.json()) as { links: CaptainLink[] }).links;
}

async function captainCookie(name: string): Promise<string> {
  const link = (await links()).find((candidate) => candidate.captainName === name)!;
  return exchangeSession("captain", token(link.link));
}

beforeEach(async () => {
  await clearDomainData();
  seeded = await seedPreparedChallenge();
  adminCookie = await adminSession();
});

describe("dinner control and captain voting", () => {
  it("enforces chronological opening and confirms missing votes before closing", async () => {
    const initial = await worker.fetch(apiRequest("/api/admin/dashboard", adminCookie), env);
    const initialBody = (await initial.json()) as {
      dashboard: { dinners: Array<{ id: string; expectedVotes: number; canOpen: boolean }> };
    };
    expect(initialBody.dashboard.dinners.map((dinner) => dinner.id)).toEqual(seeded.dinnerIds);
    expect(initialBody.dashboard.dinners.map((dinner) => dinner.expectedVotes)).toEqual([2, 2, 2]);
    expect(initialBody.dashboard.dinners.map((dinner) => dinner.canOpen)).toEqual([
      true,
      false,
      false,
    ]);

    const skipped = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[1]}/open`);
    expect(skipped.status).toBe(409);

    const opened = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/open`);
    expect(opened.status).toBe(200);
    const challenge = await env.DB
      .prepare("SELECT status FROM challenges WHERE id = ?")
      .bind(seeded.challengeId)
      .first<{ status: string }>();
    expect(challenge?.status).toBe("running");

    const withoutConfirmation = await postAdmin(
      `/api/admin/dinners/${seeded.dinnerIds[0]}/close`,
      { confirmMissing: false },
    );
    expect(withoutConfirmation.status).toBe(409);
    expect(await withoutConfirmation.json()).toMatchObject({
      error: {
        code: "MISSING_VOTES_CONFIRMATION_REQUIRED",
        missingCaptains: ["Ben", "Carla"],
      },
    });

    const closed = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/close`, {
      confirmMissing: true,
    });
    expect(closed.status).toBe(200);
    const secondOpened = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[1]}/open`);
    expect(secondOpened.status).toBe(200);
  });

  it("stores, updates, closes and restores exactly one complete captain ballot", async () => {
    await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/open`);
    const benCookie = await captainCookie("Ben");

    const dashboardResponse = await worker.fetch(
      apiRequest("/api/captain/dashboard", benCookie),
      env,
    );
    const dashboardText = await dashboardResponse.text();
    expect(dashboardText).not.toContain('"score"');
    const dashboard = JSON.parse(dashboardText) as {
      dashboard: {
        identity: { captainName: string; teamName: string };
        progress: { completed: number; total: number };
        dinners: Array<{ id: string; taskStatus: string }>;
      };
    };
    expect(dashboard.dashboard.identity).toMatchObject({
      captainName: "Ben",
      teamName: "Team Oliva",
    });
    expect(dashboard.dashboard.progress).toEqual({ completed: 0, total: 2 });
    expect(
      dashboard.dashboard.dinners.find((dinner) => dinner.id === seeded.dinnerIds[0])?.taskStatus,
    ).toBe("open");
    expect(
      dashboard.dashboard.dinners.find((dinner) => dinner.id === seeded.dinnerIds[1])?.taskStatus,
    ).toBe("own");

    const ownDinner = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[1]}/ballot`, benCookie),
      env,
    );
    expect(ownDinner.status).toBe(403);

    const ballotResponse = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie),
      env,
    );
    const ballot = (await ballotResponse.json()) as {
      ballot: { categories: Array<{ id: string }>; ratings: unknown[] };
    };
    expect(ballot.ballot.categories).toHaveLength(5);
    expect(ballot.ballot.ratings).toEqual([]);

    const incomplete = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratings: ballot.ballot.categories.slice(0, 4).map((category) => ({
            categoryId: category.id,
            score: 4,
          })),
        }),
      }),
      env,
    );
    expect(incomplete.status).toBe(422);

    const validRatings = ballot.ballot.categories.map((category, index) => ({
      categoryId: category.id,
      score: index + 1,
    }));
    const saved = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          captainTeamId: seeded.teamIds[2],
          ratings: validRatings,
        }),
      }),
      env,
    );
    expect(saved.status).toBe(200);

    const updated = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ratings: validRatings.map((rating) => ({ ...rating, score: 5 })),
        }),
      }),
      env,
    );
    expect(updated.status).toBe(200);

    const ballotRows = await env.DB.prepare(
      "SELECT captain_team_id FROM ballots WHERE dinner_id = ?",
    )
      .bind(seeded.dinnerIds[0])
      .all<{ captain_team_id: string }>();
    expect(ballotRows.results).toEqual([{ captain_team_id: seeded.teamIds[1] }]);
    const ratingCount = await env.DB.prepare(
      "SELECT COUNT(*) AS count, MIN(score) AS minimum FROM ratings",
    ).first<{ count: number; minimum: number }>();
    expect(ratingCount).toEqual({ count: 5, minimum: 5 });

    const adminDashboard = await worker.fetch(
      apiRequest("/api/admin/dashboard", adminCookie),
      env,
    );
    const adminText = await adminDashboard.text();
    expect(adminText).not.toContain('"score"');
    expect(adminText).not.toContain('"ratings"');
    const adminBody = JSON.parse(adminText) as {
      dashboard: {
        dinners: Array<{
          id: string;
          submittedVotes: number;
          participants: Array<{ captainName: string; status: string }>;
        }>;
      };
    };
    const currentDinner = adminBody.dashboard.dinners.find(
      (dinner) => dinner.id === seeded.dinnerIds[0],
    )!;
    expect(currentDinner.submittedVotes).toBe(1);
    expect(currentDinner.participants).toEqual([
      expect.objectContaining({ captainName: "Anna", status: "not_eligible" }),
      expect.objectContaining({ captainName: "Ben", status: "submitted" }),
      expect.objectContaining({ captainName: "Carla", status: "pending" }),
    ]);

    await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/close`, {
      confirmMissing: true,
    });
    const afterClose = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratings: validRatings }),
      }),
      env,
    );
    expect(afterClose.status).toBe(409);

    const reopened = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/reopen`);
    expect(reopened.status).toBe(200);
    const restored = await worker.fetch(
      apiRequest(`/api/captain/dinners/${seeded.dinnerIds[0]}/ballot`, benCookie),
      env,
    );
    const restoredBody = (await restored.json()) as {
      ballot: { ratings: Array<{ score: number }> };
    };
    expect(restoredBody.ballot.ratings).toHaveLength(5);
    expect(restoredBody.ballot.ratings.every((rating) => rating.score === 5)).toBe(true);
  });

  it("never allows two concurrent reopened dinners", async () => {
    await env.DB.batch([
      env.DB
        .prepare("UPDATE challenges SET status = 'running' WHERE id = ?")
        .bind(seeded.challengeId),
      env.DB
        .prepare("UPDATE dinners SET status = 'closed', closed_at = ? WHERE challenge_id = ?")
        .bind("2026-08-30T08:00:00.000Z", seeded.challengeId),
    ]);

    const responses = await Promise.all([
      postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/reopen`),
      postAdmin(`/api/admin/dinners/${seeded.dinnerIds[1]}/reopen`),
    ]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);

    const count = await env.DB
      .prepare("SELECT COUNT(*) AS count FROM dinners WHERE status = 'open'")
      .first<{ count: number }>();
    expect(count?.count).toBe(1);
  });

  it("allows no dinner transition after the challenge is revealed", async () => {
    await env.DB.batch([
      env.DB
        .prepare("UPDATE challenges SET status = 'revealed', revealed_at = ? WHERE id = ?")
        .bind("2026-08-30T12:00:00.000Z", seeded.challengeId),
      env.DB
        .prepare("UPDATE dinners SET status = 'closed', closed_at = ? WHERE id = ?")
        .bind("2026-08-30T11:00:00.000Z", seeded.dinnerIds[0]),
    ]);

    const reopen = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[0]}/reopen`);
    const open = await postAdmin(`/api/admin/dinners/${seeded.dinnerIds[1]}/open`);
    expect(reopen.status).toBe(409);
    expect(open.status).toBe(409);

    const response = await worker.fetch(apiRequest("/api/admin/dashboard", adminCookie), env);
    const body = (await response.json()) as {
      dashboard: { dinners: Array<{ canOpen: boolean; canClose: boolean; canReopen: boolean }> };
    };
    expect(body.dashboard.dinners.every((dinner) =>
      !dinner.canOpen && !dinner.canClose && !dinner.canReopen
    )).toBe(true);
  });
});
