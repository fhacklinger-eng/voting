import { env } from "cloudflare:workers";

export async function clearDomainData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ratings"),
    env.DB.prepare("DELETE FROM ballots"),
    env.DB.prepare("DELETE FROM dinners"),
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
        "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("team-2", "challenge-1", "Team Oliva", "team oliva", "Ben"),
    env.DB
      .prepare(
        "INSERT INTO teams (id, challenge_id, name, name_key, captain_name) VALUES (?, ?, ?, ?, ?)",
      )
      .bind("team-3", "challenge-1", "Team Pomodoro", "team pomodoro", "Carla"),
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
