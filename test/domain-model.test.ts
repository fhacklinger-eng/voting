import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  persistCompleteBallot,
  saveCompleteBallot,
  type CompleteBallot,
} from "../worker/persistence/ballots";
import { clearDomainData, seedChallenge } from "./fixtures";

const validBallot: CompleteBallot = {
  challengeId: "challenge-1",
  dinnerId: "dinner-1",
  voterId: "team-2",
  ratings: [1, 2, 3, 4, 5].map((score) => ({
    categoryId: `category-${score}`,
    score,
  })),
};

beforeEach(async () => {
  await clearDomainData();
  await seedChallenge();
});

describe("D1 domain model", () => {
  it("creates every required domain table through migrations", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all<{ name: string }>();

    expect(tables.results.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        "ballots",
        "categories",
        "challenges",
        "dinners",
        "ratings",
        "teams",
        "voters",
      ]),
    );
  });

  it("prevents two open dinners for one challenge", async () => {
    await expect(
      env.DB.prepare("UPDATE dinners SET status = 'open' WHERE id = 'dinner-2'").run(),
    ).rejects.toThrow();

    const open = await env.DB.prepare(
      "SELECT id FROM dinners WHERE challenge_id = ? AND status = 'open'",
    )
      .bind("challenge-1")
      .all<{ id: string }>();
    expect(open.results.map((dinner) => dinner.id)).toEqual(["dinner-1"]);
  });

  it("stores a complete ballot atomically and updates it without duplicates", async () => {
    await saveCompleteBallot(env.DB, validBallot);
    await saveCompleteBallot(env.DB, {
      ...validBallot,
      ratings: validBallot.ratings.map((rating) => ({ ...rating, score: 5 })),
    });

    const ballots = await env.DB.prepare("SELECT COUNT(*) AS count FROM ballots").first<{
      count: number;
    }>();
    const ratings = await env.DB.prepare(
      "SELECT COUNT(*) AS count, MIN(score) AS minimum FROM ratings",
    ).first<{ count: number; minimum: number }>();

    expect(ballots).toEqual({ count: 1 });
    expect(ratings).toEqual({ count: 5, minimum: 5 });
  });

  it("rolls back the entire D1 batch when one rating violates a foreign key", async () => {
    await expect(
      persistCompleteBallot(env.DB, {
        ...validBallot,
        ratings: validBallot.ratings.map((rating, index) =>
          index === 4 ? { ...rating, categoryId: "missing-category" } : rating,
        ),
      }),
    ).rejects.toThrow();

    const ballots = await env.DB.prepare("SELECT COUNT(*) AS count FROM ballots").first<{
      count: number;
    }>();
    const ratings = await env.DB.prepare("SELECT COUNT(*) AS count FROM ratings").first<{
      count: number;
    }>();

    expect(ballots?.count).toBe(0);
    expect(ratings?.count).toBe(0);
  });
});
