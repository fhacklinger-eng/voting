import type {
  ChallengeStatus,
  DinnerStatus,
  VoterRole,
} from "../domain/challenge-setup";

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
      voterId: string;
      role: VoterRole;
      displayName: string;
      teamId: string | null;
      teamName: string | null;
      status: ParticipationStatus;
    }>;
  }>;
  reveal: null | {
    canReveal: boolean;
    blocker: "DINNERS_NOT_CLOSED" | "TEAM_WITHOUT_VOTES" | null;
    blockedTeams: string[];
  };
}

export interface MissingParticipant {
  voterId: string;
  role: VoterRole;
  displayName: string;
  teamName: string | null;
}

export class DinnerTransitionError extends Error {
  constructor(
    public readonly code:
      | "DINNER_NOT_OPENABLE"
      | "DINNER_NOT_OPEN"
      | "DINNER_NOT_REOPENABLE"
      | "MISSING_VOTES_CONFIRMATION_REQUIRED",
    message: string,
    public readonly missingVoters: MissingParticipant[] = [],
  ) {
    super(message);
  }
}

interface ChallengeRow {
  id: string;
  name: string;
  status: ChallengeStatus;
}

interface VoterRow {
  id: string;
  role: VoterRole;
  display_name: string;
  team_id: string | null;
  team_name: string | null;
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
  voter_id: string;
}

export async function readAdminDashboard(db: D1Database): Promise<AdminDashboard> {
  const challenge = await db
    .prepare("SELECT id, name, status FROM challenges ORDER BY created_at LIMIT 1")
    .first<ChallengeRow>();
  if (!challenge) return { challenge: null, dinners: [], reveal: null };

  const [voterResult, dinnerResult, ballotResult] = await Promise.all([
    db
      .prepare(
        `SELECT voter.id,
                voter.role,
                voter.display_name,
                voter.team_id,
                team.name AS team_name
         FROM voters AS voter
         LEFT JOIN teams AS team
           ON team.id = voter.team_id AND team.challenge_id = voter.challenge_id
         WHERE voter.challenge_id = ?
         ORDER BY CASE voter.role WHEN 'captain' THEN 0 ELSE 1 END,
                  COALESCE(team.name, voter.name_key), voter.id`,
      )
      .bind(challenge.id)
      .all<VoterRow>(),
    db
      .prepare(
        `SELECT dinner.id,
                dinner.team_id,
                team.name AS team_name,
                captain.display_name AS captain_name,
                dinner.dinner_date,
                dinner.status
         FROM dinners AS dinner
         JOIN teams AS team
           ON team.id = dinner.team_id AND team.challenge_id = dinner.challenge_id
         JOIN voters AS captain
           ON captain.team_id = team.id
          AND captain.challenge_id = team.challenge_id
          AND captain.role = 'captain'
         WHERE dinner.challenge_id = ?
         ORDER BY dinner.dinner_date, team.name`,
      )
      .bind(challenge.id)
      .all<DinnerRow>(),
    db
      .prepare(
        `SELECT ballot.dinner_id,
                COALESCE(ballot.voter_id, ballot.captain_team_id) AS voter_id
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         WHERE ballot.challenge_id = ?
         GROUP BY ballot.id, ballot.dinner_id, COALESCE(ballot.voter_id, ballot.captain_team_id)
         HAVING COUNT(DISTINCT rating.category_id) = 5`,
      )
      .bind(challenge.id)
      .all<BallotRow>(),
  ]);

  const submitted = new Set(
    ballotResult.results.map((ballot) => `${ballot.dinner_id}:${ballot.voter_id}`),
  );
  const openDinner = dinnerResult.results.find((dinner) => dinner.status === "open");

  const dinners = dinnerResult.results.map((dinner) => {
    const participants = voterResult.results.map((voter) => ({
      voterId: voter.id,
      role: voter.role,
      displayName: voter.display_name,
      teamId: voter.team_id,
      teamName: voter.team_name,
      status:
        voter.role === "captain" && voter.team_id === dinner.team_id
          ? ("not_eligible" as const)
          : submitted.has(`${dinner.id}:${voter.id}`)
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
      expectedVotes: participants.filter(
        (participant) => participant.status !== "not_eligible",
      ).length,
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

async function missingVoters(
  db: D1Database,
  dinnerId: string,
): Promise<MissingParticipant[]> {
  const result = await db
    .prepare(
      `SELECT voter.id AS voter_id,
              voter.role,
              voter.display_name,
              team.name AS team_name
       FROM dinners AS dinner
       JOIN voters AS voter ON voter.challenge_id = dinner.challenge_id
       LEFT JOIN teams AS team
         ON team.id = voter.team_id AND team.challenge_id = voter.challenge_id
       LEFT JOIN (
         SELECT ballot.id,
                ballot.dinner_id,
                COALESCE(ballot.voter_id, ballot.captain_team_id) AS voter_id
         FROM ballots AS ballot
         JOIN ratings AS rating
           ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
         GROUP BY ballot.id,
                  ballot.dinner_id,
                  COALESCE(ballot.voter_id, ballot.captain_team_id)
         HAVING COUNT(DISTINCT rating.category_id) = 5
       ) AS ballot
         ON ballot.dinner_id = dinner.id AND ballot.voter_id = voter.id
       WHERE dinner.id = ?
         AND (voter.role = 'jury' OR voter.team_id <> dinner.team_id)
         AND ballot.id IS NULL
       ORDER BY CASE voter.role WHEN 'captain' THEN 0 ELSE 1 END,
                voter.name_key,
                voter.id`,
    )
    .bind(dinnerId)
    .all<{
      voter_id: string;
      role: VoterRole;
      display_name: string;
      team_name: string | null;
    }>();
  return result.results.map((row) => ({
    voterId: row.voter_id,
    role: row.role,
    displayName: row.display_name,
    teamName: row.team_name,
  }));
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

  const missing = await missingVoters(db, dinnerId);
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
