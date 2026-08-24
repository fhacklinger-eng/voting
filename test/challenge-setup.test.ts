import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../worker";
import { DEFAULT_CATEGORIES } from "../worker/domain/challenge-setup";
import { clearDomainData } from "./fixtures";

const setup = {
  name: "Gargano Koch-Challenge",
  teams: [
    {
      name: "Team Limone",
      captainName: "Anna",
      dinnerDate: "2026-08-25",
    },
    {
      name: "Team Oliva",
      captainName: "Ben",
      dinnerDate: "2026-08-27",
    },
    {
      name: "Team Pomodoro",
      captainName: "Carla",
      dinnerDate: "2026-08-29",
    },
  ],
  categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
};

interface ChallengeResponse {
  challenge: {
    id: string;
    name: string;
    status: "preparation" | "running" | "revealed";
    teams: Array<{
      id: string;
      name: string;
      captainName: string;
      dinner: { id: string; date: string; status: "upcoming" | "open" | "closed" };
    }>;
    categories: Array<{
      id: string;
      position: number;
      name: string;
      question: string;
    }>;
  };
}

function request(body: unknown): Request {
  return new Request("https://voting.example/api/admin/challenge", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function save(body: unknown): Promise<{ response: Response; payload: ChallengeResponse }> {
  const response = await worker.fetch(request(body), env);
  return { response, payload: (await response.json()) as ChallengeResponse };
}

function editablePayload(challenge: ChallengeResponse["challenge"]) {
  return {
    name: challenge.name,
    teams: challenge.teams.map((team) => ({
      id: team.id,
      name: team.name,
      captainName: team.captainName,
      dinnerDate: team.dinner.date,
    })),
    categories: challenge.categories.map((category) => ({
      id: category.id,
      name: category.name,
      question: category.question,
    })),
  };
}

beforeEach(async () => {
  await clearDomainData();
});

describe("challenge setup API", () => {
  it("starts empty and creates a complete challenge atomically", async () => {
    const initial = await worker.fetch(
      new Request("https://voting.example/api/admin/challenge"),
      env,
    );
    expect(await initial.json()).toEqual({ challenge: null });

    const { response, payload } = await save({ ...setup, categories: undefined });

    expect(response.status).toBe(200);
    expect(payload.challenge.name).toBe(setup.name);
    expect(payload.challenge.status).toBe("preparation");
    expect(payload.challenge.teams).toHaveLength(3);
    expect(payload.challenge.categories.map((category) => category.name)).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.name),
    );

    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM challenges) AS challenges,
         (SELECT COUNT(*) FROM teams) AS teams,
         (SELECT COUNT(*) FROM dinners) AS dinners,
         (SELECT COUNT(*) FROM categories) AS categories`,
    ).first<{ challenges: number; teams: number; dinners: number; categories: number }>();
    expect(counts).toEqual({ challenges: 1, teams: 3, dinners: 3, categories: 5 });
  });

  it("returns field errors and keeps the database empty for invalid input", async () => {
    const invalid = {
      ...setup,
      teams: setup.teams.map((team, index) => ({
        ...team,
        name: index < 2 ? " Team LIMONE " : team.name,
        dinnerDate: index < 2 ? "2026-08-25" : team.dinnerDate,
      })),
      categories: setup.categories.map((category, index) => ({
        ...category,
        name: index < 2 ? "Geschmack" : category.name,
      })),
    };

    const response = await worker.fetch(request(invalid), env);
    const payload = (await response.json()) as {
      error: { code: string; fieldErrors: Record<string, string> };
    };

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("VALIDATION_FAILED");
    expect(payload.error.fieldErrors).toMatchObject({
      "teams.0.name": expect.any(String),
      "teams.1.name": expect.any(String),
      "teams.0.dinnerDate": expect.any(String),
      "teams.1.dinnerDate": expect.any(String),
      "categories.0.name": expect.any(String),
      "categories.1.name": expect.any(String),
    });

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM challenges").first<{
      count: number;
    }>();
    expect(count?.count).toBe(0);
  });

  it("updates preparation data while preserving existing team identities", async () => {
    const created = (await save(setup)).payload.challenge;
    const payload = editablePayload(created);
    payload.name = "Cucina Cup";
    payload.teams[0].name = "Team Rosmarino";
    payload.teams[0].dinnerDate = payload.teams[1].dinnerDate;
    payload.teams[1].dinnerDate = created.teams[0].dinner.date;
    payload.categories[4].question = "War das ein Abend für die Urlaubschronik?";

    const { response, payload: saved } = await save(payload);

    expect(response.status).toBe(200);
    expect(saved.challenge.name).toBe("Cucina Cup");
    expect(saved.challenge.teams.map((team) => team.id).sort()).toEqual(
      created.teams.map((team) => team.id).sort(),
    );
    expect(saved.challenge.teams.find((team) => team.name === "Team Rosmarino")?.dinner.date).toBe(
      "2026-08-27",
    );
    expect(saved.challenge.categories[4].question).toBe(
      "War das ein Abend für die Urlaubschronik?",
    );
  });

  it("allows only future dinner dates after the challenge starts", async () => {
    const created = (await save(setup)).payload.challenge;
    await env.DB.batch([
      env.DB.prepare("UPDATE challenges SET status = 'running' WHERE id = ?").bind(created.id),
      env.DB
        .prepare(
          "UPDATE dinners SET status = 'closed', opened_at = ?, closed_at = ? WHERE id = ?",
        )
        .bind("2026-08-25T18:00:00.000Z", "2026-08-26T08:00:00.000Z", created.teams[0].dinner.id),
    ]);

    const running = {
      ...created,
      status: "running" as const,
      teams: created.teams.map((team, index) => ({
        ...team,
        dinner: { ...team.dinner, status: index === 0 ? ("closed" as const) : team.dinner.status },
      })),
    };
    const changedDate = editablePayload(running);
    changedDate.teams[1].dinnerDate = "2026-08-28";

    const saved = await save(changedDate);
    expect(saved.response.status).toBe(200);
    expect(saved.payload.challenge.teams.find((team) => team.id === created.teams[1].id)?.dinner.date).toBe(
      "2026-08-28",
    );

    const swappedDates = editablePayload(saved.payload.challenge);
    const firstUpcoming = swappedDates.teams.find((team) => team.id === created.teams[1].id)!;
    const secondUpcoming = swappedDates.teams.find((team) => team.id === created.teams[2].id)!;
    [firstUpcoming.dinnerDate, secondUpcoming.dinnerDate] = [
      secondUpcoming.dinnerDate,
      firstUpcoming.dinnerDate,
    ];
    const swapped = await save(swappedDates);
    expect(swapped.response.status).toBe(200);

    const changedTeam = editablePayload(swapped.payload.challenge);
    changedTeam.teams[1].captainName = "Jemand anderes";
    const locked = await worker.fetch(request(changedTeam), env);
    expect(locked.status).toBe(409);

    const invalidOrder = editablePayload(swapped.payload.challenge);
    invalidOrder.teams[2].dinnerDate = "2026-08-24";
    const invalid = await worker.fetch(request(invalidOrder), env);
    const invalidPayload = (await invalid.json()) as {
      error: { fieldErrors: Record<string, string> };
    };
    expect(invalid.status).toBe(422);
    expect(invalidPayload.error.fieldErrors["teams.2.dinnerDate"]).toContain("durchgeführten");
  });

  it("rejects every configuration change after reveal", async () => {
    const created = (await save(setup)).payload.challenge;
    await env.DB
      .prepare("UPDATE challenges SET status = 'revealed', revealed_at = ? WHERE id = ?")
      .bind("2026-09-01T20:00:00.000Z", created.id)
      .run();

    const response = await worker.fetch(request(editablePayload(created)), env);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "CONFIGURATION_LOCKED" },
    });
  });
});
