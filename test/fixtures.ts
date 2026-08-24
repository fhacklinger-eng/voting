import { env } from "cloudflare:workers";
import { DEFAULT_CATEGORIES } from "../worker/domain/challenge-setup";

export async function clearDomainData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ratings"),
    env.DB.prepare("DELETE FROM ballots"),
    env.DB.prepare("DELETE FROM dinners"),
    env.DB.prepare("DELETE FROM voters"),
    env.DB.prepare("DELETE FROM categories"),
    env.DB.prepare("DELETE FROM teams"),
    env.DB.prepare("DELETE FROM challenges"),
  ]);
}

export async function seedChallenge(): Promise<void> {
  const now = "2026-08-24T10:00:00.000Z";
  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO challenges (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("challenge-1", "Gargano Koch-Challenge", "running", now, now),
    env.DB
      .prepare(
        "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("team-1", "challenge-1", "Team Limone", "team limone", "Anna"),
    env.DB
      .prepare(
        `INSERT INTO voters (
           id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
         ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)`,
      )
      .bind("team-1", "challenge-1", "Anna", "anna", "team-1", now, now),
    env.DB
      .prepare(
        "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("team-2", "challenge-1", "Team Oliva", "team oliva", "Ben"),
    env.DB
      .prepare(
        `INSERT INTO voters (
           id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
         ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)`,
      )
      .bind("team-2", "challenge-1", "Ben", "ben", "team-2", now, now),
    env.DB
      .prepare(
        "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("team-3", "challenge-1", "Team Pomodoro", "team pomodoro", "Carla"),
    env.DB
      .prepare(
        `INSERT INTO voters (
           id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
         ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)`,
      )
      .bind("team-3", "challenge-1", "Carla", "carla", "team-3", now, now),
    ...[1, 2, 3, 4, 5].map((position) =>
      env.DB
        .prepare(
          "INSERT INTO categories (id, challenge_id, position, name, name_key, question) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(
          `category-${position}`,
          "challenge-1",
          position,
          `Kategorie ${position}`,
          `kategorie ${position}`,
          `Frage ${position}?`,
        ),
    ),
    env.DB
      .prepare(
        "INSERT INTO dinners (id, challenge_id, team_id, dinner_date, status, opened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "dinner-1",
        "challenge-1",
        "team-1",
        "2026-08-25",
        "open",
        now,
        now,
        now,
      ),
    env.DB
      .prepare(
        "INSERT INTO dinners (id, challenge_id, team_id, dinner_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "dinner-2",
        "challenge-1",
        "team-2",
        "2026-08-27",
        "upcoming",
        now,
        now,
      ),
  ]);
}

export async function seedPreparedChallenge(): Promise<{
  challengeId: string;
  teamIds: [string, string, string];
  dinnerIds: [string, string, string];
}> {
  const challengeId = "prepared-challenge";
  const teamIds: [string, string, string] = [
    "prepared-team-1",
    "prepared-team-2",
    "prepared-team-3",
  ];
  const dinnerIds: [string, string, string] = [
    "prepared-dinner-1",
    "prepared-dinner-2",
    "prepared-dinner-3",
  ];
  const names = [
    { team: "Team Limone", captain: "Anna" },
    { team: "Team Oliva", captain: "Ben" },
    { team: "Team Pomodoro", captain: "Carla" },
  ];
  const dates = ["2026-08-25", "2026-08-27", "2026-08-29"];
  const now = "2026-08-24T10:00:00.000Z";

  await env.DB.batch([
    env.DB
      .prepare(
        "INSERT INTO challenges (id, name, status, created_at, updated_at) VALUES (?, ?, 'preparation', ?, ?)",
      )
      .bind(challengeId, "Gargano Koch-Challenge", now, now),
    ...DEFAULT_CATEGORIES.map((category, index) =>
      env.DB
        .prepare(
          `INSERT INTO categories (id, challenge_id, position, name, name_key, question)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `prepared-category-${index + 1}`,
          challengeId,
          index + 1,
          category.name,
          category.name.toLocaleLowerCase("de-DE"),
          category.question,
        ),
    ),
    ...teamIds.flatMap((teamId, index) => [
      env.DB
        .prepare(
          "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(
          teamId,
          challengeId,
          names[index].team,
          names[index].team.toLocaleLowerCase("de-DE"),
          names[index].captain,
        ),
      env.DB
        .prepare(
          `INSERT INTO voters (
             id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
           ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)`,
        )
        .bind(
          teamId,
          challengeId,
          names[index].captain,
          names[index].captain.toLocaleLowerCase("de-DE"),
          teamId,
          now,
          now,
        ),
      env.DB
        .prepare(
          `INSERT INTO dinners (
             id, challenge_id, team_id, dinner_date, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'upcoming', ?, ?)`,
        )
        .bind(dinnerIds[index], challengeId, teamId, dates[index], now, now),
    ]),
  ]);

  return { challengeId, teamIds, dinnerIds };
}
