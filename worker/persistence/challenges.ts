import {
  type ChallengeConfiguration,
  type ChallengeStatus,
  ConfigurationValidationError,
  type DinnerStatus,
  nameKey,
  type NormalizedChallengeSetup,
  validateChallengeSetup,
} from "../domain/challenge-setup";

export class ConfigurationConflictError extends Error {
  constructor(
    public readonly code: "CONFIGURATION_LOCKED" | "DINNER_DATE_LOCKED",
    message: string,
  ) {
    super(message);
  }
}

interface ChallengeRow {
  id: string;
  name: string;
  status: ChallengeStatus;
}

interface CategoryRow {
  id: string;
  position: number;
  name: string;
  question: string;
}

interface TeamDinnerRow {
  team_id: string;
  team_name: string;
  captain_name: string;
  dinner_id: string;
  dinner_date: string;
  dinner_status: DinnerStatus;
}

interface JuryRow {
  id: string;
  display_name: string;
}

export async function readChallengeConfiguration(
  db: D1Database,
): Promise<ChallengeConfiguration | null> {
  const challenge = await db
    .prepare("SELECT id, name, status FROM challenges ORDER BY created_at LIMIT 1")
    .first<ChallengeRow>();

  if (!challenge) return null;

  const [categories, teams, juryMembers] = await Promise.all([
    db
      .prepare(
        "SELECT id, position, name, question FROM categories WHERE challenge_id = ? ORDER BY position",
      )
      .bind(challenge.id)
      .all<CategoryRow>(),
    db
      .prepare(
        `SELECT team.id AS team_id,
                team.name AS team_name,
                captain.display_name AS captain_name,
                dinner.id AS dinner_id,
                dinner.dinner_date,
                dinner.status AS dinner_status
         FROM teams AS team
         JOIN voters AS captain
           ON captain.team_id = team.id
          AND captain.challenge_id = team.challenge_id
          AND captain.role = 'captain'
         JOIN dinners AS dinner
           ON dinner.team_id = team.id AND dinner.challenge_id = team.challenge_id
         WHERE team.challenge_id = ?
         ORDER BY dinner.dinner_date, team.name`,
      )
      .bind(challenge.id)
      .all<TeamDinnerRow>(),
    db
      .prepare(
        `SELECT id, display_name
         FROM voters
         WHERE challenge_id = ? AND role = 'jury'
         ORDER BY name_key, id`,
      )
      .bind(challenge.id)
      .all<JuryRow>(),
  ]);

  return {
    id: challenge.id,
    name: challenge.name,
    status: challenge.status,
    teams: teams.results.map((row) => ({
      id: row.team_id,
      name: row.team_name,
      captainName: row.captain_name,
      dinner: {
        id: row.dinner_id,
        date: row.dinner_date,
        status: row.dinner_status,
      },
    })),
    juryMembers: juryMembers.results.map((row) => ({
      id: row.id,
      name: row.display_name,
    })),
    categories: categories.results,
  };
}

function insertNewConfiguration(
  db: D1Database,
  input: NormalizedChallengeSetup,
): D1PreparedStatement[] {
  const challengeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const teams = input.teams.map((team) => ({ ...team, id: crypto.randomUUID() }));

  return [
    db
      .prepare(
        "INSERT INTO challenges (id, name, status, created_at, updated_at) VALUES (?, ?, 'preparation', ?, ?)",
      )
      .bind(challengeId, input.name, now, now),
    ...input.categories.map((category, index) =>
      db
        .prepare(
          `INSERT INTO categories (id, challenge_id, position, name, name_key, question)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          challengeId,
          index + 1,
          category.name,
          category.nameKey,
          category.question,
        ),
    ),
    ...teams.flatMap((team) => [
        db
          .prepare(
            `INSERT INTO teams (id, challenge_id, name, name_key, captain_name)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(team.id, challengeId, team.name, team.nameKey, team.captainName),
        db
          .prepare(
            `INSERT INTO voters (
               id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
             ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)`,
          )
          .bind(
            team.id,
            challengeId,
            team.captainName,
            nameKey(team.captainName),
            team.id,
            now,
            now,
          ),
        db
          .prepare(
            `INSERT INTO dinners (
               id, challenge_id, team_id, dinner_date, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'upcoming', ?, ?)`,
          )
          .bind(crypto.randomUUID(), challengeId, team.id, team.dinnerDate, now, now),
      ]),
    ...input.juryMembers.map((member) =>
      db
        .prepare(
          `INSERT INTO voters (
             id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
           ) VALUES (?, ?, 'jury', ?, ?, NULL, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          challengeId,
          member.name,
          member.nameKey,
          now,
          now,
        ),
    ),
  ];
}

function sameCategory(
  current: ChallengeConfiguration["categories"][number],
  incoming: NormalizedChallengeSetup["categories"][number],
): boolean {
  return current.name === incoming.name && current.question === incoming.question;
}

function assertOnlyUpcomingDatesChanged(
  current: ChallengeConfiguration,
  input: NormalizedChallengeSetup,
): Array<{ dinnerId: string; date: string }> {
  if (current.name !== input.name || current.teams.length !== input.teams.length) {
    throw new ConfigurationConflictError(
      "CONFIGURATION_LOCKED",
      "Nach dem ersten geöffneten Kochabend sind Challenge und Teams gesperrt.",
    );
  }

  if (
    current.categories.length !== input.categories.length ||
    current.categories.some((category, index) => !sameCategory(category, input.categories[index]))
  ) {
    throw new ConfigurationConflictError(
      "CONFIGURATION_LOCKED",
      "Nach dem ersten geöffneten Kochabend sind die Kategorien gesperrt.",
    );
  }

  if (
    current.juryMembers.length !== input.juryMembers.length ||
    current.juryMembers.some((member, index) => {
      const incoming = input.juryMembers[index];
      return !incoming || incoming.id !== member.id || incoming.name !== member.name;
    })
  ) {
    throw new ConfigurationConflictError(
      "CONFIGURATION_LOCKED",
      "Nach dem ersten geöffneten Kochabend ist die Jury gesperrt.",
    );
  }

  const currentById = new Map(current.teams.map((team) => [team.id, team]));
  const updates: Array<{ dinnerId: string; date: string }> = [];

  for (const team of input.teams) {
    const existing = team.id ? currentById.get(team.id) : undefined;
    if (
      !existing ||
      existing.name !== team.name ||
      existing.captainName !== team.captainName
    ) {
      throw new ConfigurationConflictError(
        "CONFIGURATION_LOCKED",
        "Nach dem ersten geöffneten Kochabend sind Teams und Captains gesperrt.",
      );
    }

    if (existing.dinner.date !== team.dinnerDate) {
      if (existing.dinner.status !== "upcoming") {
        throw new ConfigurationConflictError(
          "DINNER_DATE_LOCKED",
          "Das Datum eines bereits geöffneten oder geschlossenen Kochabends ist gesperrt.",
        );
      }
      updates.push({ dinnerId: existing.dinner.id, date: team.dinnerDate });
    }
  }

  const completedDates = current.teams
    .filter((team) => team.dinner.status !== "upcoming")
    .map((team) => team.dinner.date)
    .sort();
  const latestCompletedDate = completedDates.at(-1);

  if (latestCompletedDate && input.teams.some((team) => team.dinnerDate <= latestCompletedDate)) {
    const fieldErrors: Record<string, string> = {};
    input.teams.forEach((team, index) => {
      const existing = team.id ? currentById.get(team.id) : undefined;
      if (existing?.dinner.status === "upcoming" && team.dinnerDate <= latestCompletedDate) {
        fieldErrors[`teams.${index}.dinnerDate`] =
          "Ein bevorstehender Abend muss nach den bereits durchgeführten Abenden liegen.";
      }
    });
    if (Object.keys(fieldErrors).length > 0) {
      throw new ConfigurationValidationError(fieldErrors);
    }
  }

  return updates;
}

function updatePreparationConfiguration(
  db: D1Database,
  current: ChallengeConfiguration,
  input: NormalizedChallengeSetup,
): D1PreparedStatement[] {
  const now = new Date().toISOString();
  const existingTeams = new Map(current.teams.map((team) => [team.id, team]));
  const claimedTeamIds = new Set<string>();
  const resolvedTeams = input.teams.map((team) => {
    const existing =
      team.id && !claimedTeamIds.has(team.id) ? existingTeams.get(team.id) : undefined;
    if (existing) claimedTeamIds.add(existing.id);
    return {
      ...team,
      id: existing?.id ?? crypto.randomUUID(),
      dinnerId: existing?.dinner.id ?? crypto.randomUUID(),
    };
  });
  const retainedTeamIds = resolvedTeams.map((team) => team.id);
  const teamPlaceholders = retainedTeamIds.map(() => "?").join(", ");
  const existingJury = new Map(current.juryMembers.map((member) => [member.id, member]));
  const claimedJuryIds = new Set<string>();
  const resolvedJury = input.juryMembers.map((member) => {
    const existing =
      member.id && !claimedJuryIds.has(member.id) ? existingJury.get(member.id) : undefined;
    if (existing) claimedJuryIds.add(existing.id);
    return { ...member, id: existing?.id ?? crypto.randomUUID() };
  });
  const retainedVoterIds = [
    ...resolvedTeams.map((team) => team.id),
    ...resolvedJury.map((member) => member.id),
  ];
  const voterPlaceholders = retainedVoterIds.map(() => "?").join(", ");

  return [
    db
      .prepare("UPDATE challenges SET name = ?, updated_at = ? WHERE id = ? AND status = 'preparation'")
      .bind(input.name, now, current.id),
    db
      .prepare("UPDATE categories SET name_key = '__pending__:' || id WHERE challenge_id = ?")
      .bind(current.id),
    ...input.categories.map((category, index) =>
      db
        .prepare(
          `UPDATE categories
           SET name = ?, name_key = ?, question = ?
           WHERE id = ? AND challenge_id = ? AND position = ?`,
        )
        .bind(
          category.name,
          category.nameKey,
          category.question,
          current.categories[index].id,
          current.id,
          index + 1,
        ),
    ),
    db
      .prepare("UPDATE teams SET name_key = '__pending__:' || id WHERE challenge_id = ?")
      .bind(current.id),
    db
      .prepare("UPDATE voters SET name_key = '__pending__:' || id WHERE challenge_id = ?")
      .bind(current.id),
    ...current.teams.map((team, index) =>
      db
        .prepare("UPDATE dinners SET dinner_date = ? WHERE id = ? AND challenge_id = ?")
        .bind(`${String(index + 1).padStart(4, "0")}-01-01`, team.dinner.id, current.id),
    ),
    ...resolvedTeams.map((team) =>
      db
        .prepare(
          `INSERT INTO teams (id, challenge_id, name, name_key, captain_name)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             name_key = excluded.name_key,
             captain_name = excluded.captain_name`,
        )
        .bind(team.id, current.id, team.name, team.nameKey, team.captainName),
    ),
    ...resolvedTeams.map((team) =>
      db
        .prepare(
          `INSERT INTO voters (
             id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
           ) VALUES (?, ?, 'captain', ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             role = 'captain',
             display_name = excluded.display_name,
             name_key = excluded.name_key,
             team_id = excluded.team_id,
             updated_at = excluded.updated_at`,
        )
        .bind(
          team.id,
          current.id,
          team.captainName,
          nameKey(team.captainName),
          team.id,
          now,
          now,
        ),
    ),
    ...resolvedTeams.map((team) =>
      db
        .prepare(
          `INSERT INTO dinners (
             id, challenge_id, team_id, dinner_date, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'upcoming', ?, ?)
           ON CONFLICT(team_id) DO UPDATE SET
             dinner_date = excluded.dinner_date,
             updated_at = excluded.updated_at`,
        )
        .bind(team.dinnerId, current.id, team.id, team.dinnerDate, now, now),
    ),
    ...resolvedJury.map((member) =>
      db
        .prepare(
          `INSERT INTO voters (
             id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
           ) VALUES (?, ?, 'jury', ?, ?, NULL, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             role = 'jury',
             display_name = excluded.display_name,
             name_key = excluded.name_key,
             team_id = NULL,
             updated_at = excluded.updated_at`,
        )
        .bind(member.id, current.id, member.name, member.nameKey, now, now),
    ),
    db
      .prepare(
        `DELETE FROM voters
         WHERE challenge_id = ? AND id NOT IN (${voterPlaceholders})`,
      )
      .bind(current.id, ...retainedVoterIds),
    db
      .prepare(
        `DELETE FROM dinners
         WHERE challenge_id = ? AND team_id NOT IN (${teamPlaceholders})`,
      )
      .bind(current.id, ...retainedTeamIds),
    db
      .prepare(
        `DELETE FROM teams
         WHERE challenge_id = ? AND id NOT IN (${teamPlaceholders})`,
      )
      .bind(current.id, ...retainedTeamIds),
  ];
}

export async function saveChallengeConfiguration(
  db: D1Database,
  rawInput: unknown,
): Promise<ChallengeConfiguration> {
  const input = validateChallengeSetup(rawInput);
  const current = await readChallengeConfiguration(db);

  if (!current) {
    await db.batch(insertNewConfiguration(db, input));
    const created = await readChallengeConfiguration(db);
    if (!created) throw new Error("Challenge could not be read after creation");
    return created;
  }

  if (current.status === "revealed") {
    throw new ConfigurationConflictError(
      "CONFIGURATION_LOCKED",
      "Nach der Auflösung kann die Challenge nicht mehr geändert werden.",
    );
  }

  if (current.status === "preparation") {
    await db.batch(updatePreparationConfiguration(db, current, input));
  } else {
    const updates = assertOnlyUpcomingDatesChanged(current, input);
    const now = new Date().toISOString();
    if (updates.length > 0) {
      await db.batch(
        [
          ...updates.map((update, index) =>
            db
              .prepare("UPDATE dinners SET dinner_date = ? WHERE id = ? AND status = 'upcoming'")
              .bind(`${String(index + 1).padStart(4, "0")}-02-01`, update.dinnerId),
          ),
          ...updates.map((update) =>
            db
              .prepare(
                `UPDATE dinners SET dinner_date = ?, updated_at = ?
                 WHERE id = ? AND status = 'upcoming'`,
              )
              .bind(update.date, now, update.dinnerId),
          ),
        ],
      );
    }
  }

  const saved = await readChallengeConfiguration(db);
  if (!saved) throw new Error("Challenge could not be read after update");
  return saved;
}
