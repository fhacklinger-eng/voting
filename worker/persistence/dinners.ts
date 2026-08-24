import type { ChallengeStatus, DinnerStatus } from "../domain/challenge-setup";

export type ParticipationStatus = "submitted" | "pending" | "not_eligible";

export interface AdminDashboard {
  challenge: null | {
    id: string;
    name: string;
    status: ChallengeStatus;
  };
  dinners: Array<{
    id: string;
    teamId: string;
    teamName: string;
    captainName: string;
    date: string;
    status: DinnerStatus;
    submittedVotes: number;
    expectedVotes: number;
    canOpen: boolean;
    canClose: boolean;
    canReopen: boolean;
    participants: Array<{
      teamId: string;
      teamName: string;
      captainName: string;
      status: ParticipationStatus;
    }>;
  }>;
  reveal: null | {
    canReveal: boolean;
    blocker: "DINNERS_NOT_CLOSED" | "TEAM_WITHOUT_VOTES" | null;
    blockedTeams: string[];
  };
}

export class DinnerTransitionError extends Error {
  constructor(
    public readonly code:
      | "DINNER_NOT_OPENABLE"
      | "DINNER_NOT_OPEN"
      | "DINNER_NOT_REOPENABLE"
      | "MISSING_VOTES_CONFIRMATION_REQUIRED",
    message: string,
    public readonly missingCaptains: string[] = [],
  ) {
    super(message);
  }
}

interface ChallengeRow {
  id: string;
  name: string;
  status: ChallengeStatus;
}

interface TeamRow {
  id: string;
  name: string;
  captain_name: string;
}

interface DinnerRow {
  id: string;
  team_id: string;
  team_name: string;
  captain_name: string;
  dinner_date: string;
  status: DinnerStatus;
}

interface BallotRow {
  dinner_id: string;
  captain_team_id: string;
}

export async function readAdminDashboard(db: D1Database): Promise<AdminDashboard> {
  const challenge = await db
    .prepare("SELECT id, name, status FROM challenges ORDER BY created_at LIMIT 1")
    .first<ChallengeRow>();
  if (!challenge) return { challenge: null, dinners: [], reveal: null };

  const [teamResult, dinnerResult, ballotResult] = await Promise.all([
    db
      .prepare("SELECT id, name, captain_name FROM teams WHERE challenge_id = ? ORDER BY name")
      .bind(challenge.id)
      .all<TeamRow>(),
    db
      .prepare(
        `SELECT dinner.id,
                dinner.team_id,
                team.name AS team_name,
                team.captain_name,
                dinner.dinner_date,
                dinner.status
         FROM dinners AS dinner
         JOIN teams AS team
           ON team.id = dinner.team_id AND team.challenge_id = dinner.challenge_id
         WHERE dinner.challenge_id = ?
         ORDER BY dinner.dinner_date, team.name`,
      )
      .bind(challenge.id)
      .all<DinnerRow>(),
    db
      .prepare(
        `SELECT ballot.dinner_id, ballot.captain_team_id
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         WHERE ballot.challenge_id = ?
         GROUP BY ballot.id, ballot.dinner_id, ballot.captain_team_id
         HAVING COUNT(DISTINCT rating.category_id) = 5`,
      )
      .bind(challenge.id)
      .all<BallotRow>(),
  ]);

  const submitted = new Set(
    ballotResult.results.map((ballot) => `${ballot.dinner_id}:${ballot.captain_team_id}`),
  );
  const openDinner = dinnerResult.results.find((dinner) => dinner.status === "open");

  const dinners = dinnerResult.results.map((dinner) => {
    const participants = teamResult.results.map((team) => ({
      teamId: team.id,
      teamName: team.name,
      captainName: team.captain_name,
      status:
        team.id === dinner.team_id
          ? ("not_eligible" as const)
          : submitted.has(`${dinner.id}:${team.id}`)
            ? ("submitted" as const)
            : ("pending" as const),
    }));
    const earlierIncomplete = dinnerResult.results.some(
      (candidate) =>
        candidate.dinner_date < dinner.dinner_date && candidate.status !== "closed",
    );
    const submittedVotes = participants.filter(
      (participant) => participant.status === "submitted",
    ).length;

    return {
      id: dinner.id,
      teamId: dinner.team_id,
      teamName: dinner.team_name,
      captainName: dinner.captain_name,
      date: dinner.dinner_date,
      status: dinner.status,
      submittedVotes,
      expectedVotes: Math.max(0, teamResult.results.length - 1),
      canOpen:
        dinner.status === "upcoming" &&
        challenge.status !== "revealed" &&
        !openDinner &&
        !earlierIncomplete,
      canClose: dinner.status === "open" && challenge.status !== "revealed",
      canReopen:
        dinner.status === "closed" && challenge.status !== "revealed" && !openDinner,
      participants,
    };
  });
  const allClosed = dinners.length > 0 && dinners.every((dinner) => dinner.status === "closed");
  const blockedTeams = dinners
    .filter((dinner) => dinner.submittedVotes === 0)
    .map((dinner) => dinner.teamName);

  return {
    challenge: { id: challenge.id, name: challenge.name, status: challenge.status },
    dinners,
    reveal: {
      canReveal:
        challenge.status !== "revealed" && allClosed && blockedTeams.length === 0,
      blocker:
        challenge.status === "revealed"
          ? null
          : !allClosed
            ? "DINNERS_NOT_CLOSED"
            : blockedTeams.length > 0
              ? "TEAM_WITHOUT_VOTES"
              : null,
      blockedTeams,
    },
  };
}

export async function openDinner(db: D1Database, dinnerId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    const results = await db.batch([
      db
        .prepare(
          `UPDATE dinners
           SET status = 'open', opened_at = COALESCE(opened_at, ?), closed_at = NULL, updated_at = ?
           WHERE id = ?
             AND status = 'upcoming'
             AND EXISTS (
               SELECT 1 FROM challenges
               WHERE challenges.id = dinners.challenge_id
                 AND challenges.status IN ('preparation', 'running')
             )
             AND NOT EXISTS (
               SELECT 1 FROM dinners AS other
               WHERE other.challenge_id = dinners.challenge_id
                 AND other.status = 'open'
             )
             AND NOT EXISTS (
               SELECT 1 FROM dinners AS earlier
               WHERE earlier.challenge_id = dinners.challenge_id
                 AND earlier.dinner_date < dinners.dinner_date
                 AND earlier.status <> 'closed'
             )`,
        )
        .bind(now, now, dinnerId),
      db
        .prepare(
          `UPDATE challenges
           SET status = 'running', updated_at = ?
           WHERE status = 'preparation'
             AND id = (SELECT challenge_id FROM dinners WHERE id = ? AND status = 'open')`,
        )
        .bind(now, dinnerId),
    ]);
    if (results[0].meta.changes !== 1) {
      throw new DinnerTransitionError(
        "DINNER_NOT_OPENABLE",
        "Dieser Kochabend kann gerade nicht geöffnet werden. Prüfe die Reihenfolge und den aktuellen Abend.",
      );
    }
  } catch (error) {
    if (error instanceof DinnerTransitionError) throw error;
    throw new DinnerTransitionError(
      "DINNER_NOT_OPENABLE",
      "Ein anderer Kochabend ist bereits offen. Bitte aktualisiere die Übersicht.",
    );
  }
}

async function missingCaptains(db: D1Database, dinnerId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT team.captain_name
       FROM dinners AS dinner
       JOIN teams AS team
         ON team.challenge_id = dinner.challenge_id AND team.id <> dinner.team_id
       LEFT JOIN (
         SELECT ballot.id, ballot.dinner_id, ballot.captain_team_id
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         GROUP BY ballot.id, ballot.dinner_id, ballot.captain_team_id
         HAVING COUNT(DISTINCT rating.category_id) = 5
       ) AS ballot
         ON ballot.dinner_id = dinner.id AND ballot.captain_team_id = team.id
       WHERE dinner.id = ? AND ballot.id IS NULL
       ORDER BY team.captain_name`,
    )
    .bind(dinnerId)
    .all<{ captain_name: string }>();
  return result.results.map((row) => row.captain_name);
}

export async function closeDinner(
  db: D1Database,
  dinnerId: string,
  confirmMissing: boolean,
): Promise<void> {
  const current = await db
    .prepare(
      `SELECT dinner.status, challenge.status AS challenge_status
       FROM dinners AS dinner
       JOIN challenges AS challenge ON challenge.id = dinner.challenge_id
       WHERE dinner.id = ?`,
    )
    .bind(dinnerId)
    .first<{ status: DinnerStatus; challenge_status: ChallengeStatus }>();
  if (!current || current.status !== "open" || current.challenge_status === "revealed") {
    throw new DinnerTransitionError(
      "DINNER_NOT_OPEN",
      "Dieser Kochabend ist nicht mehr geöffnet.",
    );
  }

  const missing = await missingCaptains(db, dinnerId);
  if (missing.length > 0 && !confirmMissing) {
    throw new DinnerTransitionError(
      "MISSING_VOTES_CONFIRMATION_REQUIRED",
      "Vor dem Schließen fehlen noch Stimmen.",
      missing,
    );
  }

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE dinners
       SET status = 'closed', closed_at = ?, updated_at = ?
       WHERE id = ?
         AND status = 'open'
         AND EXISTS (
           SELECT 1 FROM challenges
           WHERE challenges.id = dinners.challenge_id AND challenges.status <> 'revealed'
         )`,
    )
    .bind(now, now, dinnerId)
    .run();
  if (result.meta.changes !== 1) {
    throw new DinnerTransitionError(
      "DINNER_NOT_OPEN",
      "Dieser Kochabend wurde zwischenzeitlich geändert. Bitte aktualisiere die Übersicht.",
    );
  }
}

export async function reopenDinner(db: D1Database, dinnerId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    const result = await db
      .prepare(
        `UPDATE dinners
         SET status = 'open', closed_at = NULL, updated_at = ?
         WHERE id = ?
           AND status = 'closed'
           AND EXISTS (
             SELECT 1 FROM challenges
             WHERE challenges.id = dinners.challenge_id AND challenges.status = 'running'
           )
           AND NOT EXISTS (
             SELECT 1 FROM dinners AS other
             WHERE other.challenge_id = dinners.challenge_id AND other.status = 'open'
           )`,
      )
      .bind(now, dinnerId)
      .run();
    if (result.meta.changes !== 1) {
      throw new DinnerTransitionError(
        "DINNER_NOT_REOPENABLE",
        "Dieser Kochabend kann gerade nicht wieder geöffnet werden.",
      );
    }
  } catch (error) {
    if (error instanceof DinnerTransitionError) throw error;
    throw new DinnerTransitionError(
      "DINNER_NOT_REOPENABLE",
      "Ein anderer Kochabend ist bereits offen. Bitte aktualisiere die Übersicht.",
    );
  }
}
