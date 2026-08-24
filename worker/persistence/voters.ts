import type {
  ChallengeStatus,
  DinnerStatus,
  VoterRole,
} from "../domain/challenge-setup";

export interface VoterIdentity {
  role: VoterRole;
  challengeId: string;
  challengeName: string;
  challengeStatus: ChallengeStatus;
  voterId: string;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
}

export interface VoterDashboard {
  identity: VoterIdentity;
  progress: { completed: number; total: number };
  dinners: Array<{
    id: string;
    teamId: string;
    teamName: string;
    date: string;
    dinnerStatus: DinnerStatus;
    isOwn: boolean;
    hasBallot: boolean;
    taskStatus: "own" | "open" | "completed" | "upcoming" | "closed";
  }>;
}

export interface VoterBallot {
  dinner: { id: string; teamName: string; date: string };
  categories: Array<{
    id: string;
    position: number;
    name: string;
    question: string;
  }>;
  ratings: Array<{ categoryId: string; score: number }>;
}

export class VoterDataError extends Error {
  constructor(
    public readonly code:
      | "VOTER_NOT_FOUND"
      | "DINNER_NOT_FOUND"
      | "DINNER_NOT_OPEN"
      | "OWN_DINNER",
    public readonly status: 401 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

interface IdentityRow {
  challenge_id: string;
  challenge_name: string;
  challenge_status: ChallengeStatus;
  voter_id: string;
  voter_role: VoterRole;
  display_name: string;
  team_id: string | null;
  team_name: string | null;
}

interface DinnerRow {
  id: string;
  team_id: string;
  team_name: string;
  dinner_date: string;
  status: DinnerStatus;
}

export async function readVoterIdentity(
  db: D1Database,
  challengeId: string,
  voterId: string,
): Promise<VoterIdentity> {
  const row = await db
    .prepare(
      `SELECT challenge.id AS challenge_id,
              challenge.name AS challenge_name,
              challenge.status AS challenge_status,
              voter.id AS voter_id,
              voter.role AS voter_role,
              voter.display_name,
              voter.team_id,
              team.name AS team_name
       FROM voters AS voter
       JOIN challenges AS challenge ON challenge.id = voter.challenge_id
       LEFT JOIN teams AS team
         ON team.id = voter.team_id AND team.challenge_id = voter.challenge_id
       WHERE challenge.id = ? AND voter.id = ?`,
    )
    .bind(challengeId, voterId)
    .first<IdentityRow>();
  if (!row) {
    throw new VoterDataError(
      "VOTER_NOT_FOUND",
      401,
      "Dieser Zugang ist nicht mehr gültig. Bitte frag die Organisation nach dem Link.",
    );
  }
  return {
    role: row.voter_role,
    challengeId: row.challenge_id,
    challengeName: row.challenge_name,
    challengeStatus: row.challenge_status,
    voterId: row.voter_id,
    displayName: row.display_name,
    teamId: row.team_id,
    teamName: row.team_name,
  };
}

export async function readVoterDashboard(
  db: D1Database,
  challengeId: string,
  voterId: string,
): Promise<VoterDashboard> {
  const identity = await readVoterIdentity(db, challengeId, voterId);
  const [dinnerResult, ballotResult] = await Promise.all([
    db
      .prepare(
        `SELECT dinner.id,
                dinner.team_id,
                team.name AS team_name,
                dinner.dinner_date,
                dinner.status
         FROM dinners AS dinner
         JOIN teams AS team
           ON team.id = dinner.team_id AND team.challenge_id = dinner.challenge_id
         WHERE dinner.challenge_id = ?
         ORDER BY dinner.dinner_date, team.name`,
      )
      .bind(challengeId)
      .all<DinnerRow>(),
    db
      .prepare(
        `SELECT ballot.dinner_id
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         WHERE ballot.challenge_id = ?
           AND COALESCE(ballot.voter_id, ballot.captain_team_id) = ?
         GROUP BY ballot.id, ballot.dinner_id
         HAVING COUNT(DISTINCT rating.category_id) = 5`,
      )
      .bind(challengeId, voterId)
      .all<{ dinner_id: string }>(),
  ]);
  const completedDinnerIds = new Set(ballotResult.results.map((ballot) => ballot.dinner_id));
  const dinners = dinnerResult.results.map((dinner) => {
    const isOwn = identity.role === "captain" && dinner.team_id === identity.teamId;
    const hasBallot = completedDinnerIds.has(dinner.id);
    const taskStatus = isOwn
      ? ("own" as const)
      : hasBallot
        ? ("completed" as const)
        : dinner.status === "open"
          ? ("open" as const)
          : dinner.status === "upcoming"
            ? ("upcoming" as const)
            : ("closed" as const);
    return {
      id: dinner.id,
      teamId: dinner.team_id,
      teamName: dinner.team_name,
      date: dinner.dinner_date,
      dinnerStatus: dinner.status,
      isOwn,
      hasBallot,
      taskStatus,
    };
  });

  return {
    identity,
    progress: {
      completed: dinners.filter((dinner) => !dinner.isOwn && dinner.hasBallot).length,
      total: dinners.filter((dinner) => !dinner.isOwn).length,
    },
    dinners,
  };
}

export async function readVoterBallot(
  db: D1Database,
  challengeId: string,
  voterId: string,
  dinnerId: string,
): Promise<VoterBallot> {
  const identity = await readVoterIdentity(db, challengeId, voterId);
  const dinner = await db
    .prepare(
      `SELECT dinner.id,
              dinner.team_id,
              team.name AS team_name,
              dinner.dinner_date,
              dinner.status
       FROM dinners AS dinner
       JOIN teams AS team
         ON team.id = dinner.team_id AND team.challenge_id = dinner.challenge_id
       JOIN challenges AS challenge ON challenge.id = dinner.challenge_id
       WHERE dinner.id = ? AND dinner.challenge_id = ? AND challenge.status <> 'revealed'`,
    )
    .bind(dinnerId, challengeId)
    .first<DinnerRow>();
  if (!dinner) {
    throw new VoterDataError(
      "DINNER_NOT_FOUND",
      404,
      "Dieser Kochabend wurde nicht gefunden.",
    );
  }
  if (identity.role === "captain" && dinner.team_id === identity.teamId) {
    throw new VoterDataError(
      "OWN_DINNER",
      403,
      "Das eigene Team darf nicht bewertet werden.",
    );
  }
  if (dinner.status !== "open") {
    throw new VoterDataError(
      "DINNER_NOT_OPEN",
      409,
      "Dieser Kochabend ist nicht mehr zur Abstimmung geöffnet.",
    );
  }

  const [categories, ratings] = await Promise.all([
    db
      .prepare(
        "SELECT id, position, name, question FROM categories WHERE challenge_id = ? ORDER BY position",
      )
      .bind(challengeId)
      .all<{ id: string; position: number; name: string; question: string }>(),
    db
      .prepare(
        `SELECT rating.category_id, rating.score
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         WHERE ballot.challenge_id = ?
           AND ballot.dinner_id = ?
           AND COALESCE(ballot.voter_id, ballot.captain_team_id) = ?`,
      )
      .bind(challengeId, dinnerId, voterId)
      .all<{ category_id: string; score: number }>(),
  ]);

  return {
    dinner: { id: dinner.id, teamName: dinner.team_name, date: dinner.dinner_date },
    categories: categories.results,
    ratings: ratings.results.map((rating) => ({
      categoryId: rating.category_id,
      score: rating.score,
    })),
  };
}
