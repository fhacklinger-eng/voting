import type { ChallengeStatus } from "../domain/challenge-setup";
import type { VoterRole } from "../domain/challenge-setup";
import { readAdminDashboard } from "./dinners";

export interface MissingVote {
  displayName: string;
  role: VoterRole;
  teamName: string | null;
  dinnerId: string;
  dinnerTeamName: string;
  dinnerDate: string;
}

export interface RankedTeam {
  place: number;
  teamName: string;
  score: number;
  ratingCount: number;
  expectedRatingCount: number;
}

export interface RevealedResults {
  challenge: { id: string; name: string };
  categories: Array<{
    id: string;
    position: number;
    name: string;
    question: string;
    ranking: RankedTeam[];
  }>;
  overall: RankedTeam[];
}

export class RevealError extends Error {
  constructor(
    public readonly code:
      | "RESULTS_ALREADY_REVEALED"
      | "DINNERS_NOT_CLOSED"
      | "TEAM_WITHOUT_VOTES"
      | "MISSING_VOTES_CONFIRMATION_REQUIRED"
      | "REVEAL_CONFLICT",
    message: string,
    public readonly missingVotes: MissingVote[] = [],
    public readonly blockedTeams: string[] = [],
  ) {
    super(message);
  }
}

export class ResultsUnavailableError extends Error {}

interface ChallengeRow {
  id: string;
  name: string;
  status: ChallengeStatus;
}

interface TeamDinnerRow {
  team_id: string;
  team_name: string;
}

interface CategoryRow {
  id: string;
  position: number;
  name: string;
  question: string;
}

interface ScoreRow {
  team_id: string;
  category_id: string;
  score_sum: number;
  rating_count: number;
}

interface InternalStanding {
  teamName: string;
  scoreHundredths: number;
  ratingCount: number;
  expectedRatingCount: number;
}

/** Commercial half-up rounding for a non-negative rational score. */
export function roundScoreToHundredths(numerator: number, denominator: number): number {
  if (
    !Number.isSafeInteger(numerator) ||
    numerator < 0 ||
    !Number.isSafeInteger(denominator) ||
    denominator <= 0
  ) {
    throw new Error("Invalid score fraction");
  }
  const scaled = BigInt(numerator) * 100n;
  const divisor = BigInt(denominator);
  const whole = scaled / divisor;
  const remainder = scaled % divisor;
  return Number(whole + (remainder * 2n >= divisor ? 1n : 0n));
}

export function densePlaces(sortedScores: number[]): number[] {
  let place = 0;
  let previous: number | undefined;
  return sortedScores.map((score) => {
    if (score !== previous) place += 1;
    previous = score;
    return place;
  });
}

function rankTeams(standings: InternalStanding[]): RankedTeam[] {
  const sorted = [...standings].sort(
    (left, right) =>
      right.scoreHundredths - left.scoreHundredths ||
      left.teamName.localeCompare(right.teamName, "de"),
  );
  const places = densePlaces(sorted.map((standing) => standing.scoreHundredths));
  return sorted.map((standing, index) => ({
    place: places[index],
    teamName: standing.teamName,
    score: standing.scoreHundredths / 100,
    ratingCount: standing.ratingCount,
    expectedRatingCount: standing.expectedRatingCount,
  }));
}

export async function revealChallenge(
  db: D1Database,
  confirmMissing: boolean,
): Promise<void> {
  const dashboard = await readAdminDashboard(db);
  if (!dashboard.challenge) {
    throw new RevealError("DINNERS_NOT_CLOSED", "Es ist noch keine Challenge eingerichtet.");
  }
  if (dashboard.challenge.status === "revealed") {
    throw new RevealError(
      "RESULTS_ALREADY_REVEALED",
      "Die Challenge wurde bereits aufgelöst.",
    );
  }
  if (
    dashboard.dinners.length === 0 ||
    dashboard.dinners.some((dinner) => dinner.status !== "closed")
  ) {
    throw new RevealError(
      "DINNERS_NOT_CLOSED",
      "Schließe zuerst alle Kochabende, bevor du das Ergebnis auflöst.",
    );
  }

  const blockedTeams = dashboard.dinners
    .filter((dinner) => dinner.submittedVotes === 0)
    .map((dinner) => dinner.teamName);
  if (blockedTeams.length > 0) {
    throw new RevealError(
      "TEAM_WITHOUT_VOTES",
      "Jedes Team braucht mindestens eine vollständige Fremdbewertung.",
      [],
      blockedTeams,
    );
  }

  const missingVotes = dashboard.dinners.flatMap((dinner) =>
    dinner.participants
      .filter((participant) => participant.status === "pending")
      .map((participant) => ({
        displayName: participant.displayName,
        role: participant.role,
        teamName: participant.teamName,
        dinnerId: dinner.id,
        dinnerTeamName: dinner.teamName,
        dinnerDate: dinner.date,
      })),
  );
  if (missingVotes.length > 0 && !confirmMissing) {
    throw new RevealError(
      "MISSING_VOTES_CONFIRMATION_REQUIRED",
      "Vor der Auflösung fehlen noch einzelne Stimmen.",
      missingVotes,
    );
  }

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE challenges
       SET status = 'revealed', revealed_at = ?, updated_at = ?
       WHERE id = ?
         AND status <> 'revealed'
         AND EXISTS (
           SELECT 1 FROM dinners
           WHERE dinners.challenge_id = challenges.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM dinners
           WHERE dinners.challenge_id = challenges.id AND dinners.status <> 'closed'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM dinners AS dinner
           WHERE dinner.challenge_id = challenges.id
             AND NOT EXISTS (
               SELECT ballot.id
               FROM ballots AS ballot
               JOIN voters AS voter
                 ON voter.id = COALESCE(ballot.voter_id, ballot.captain_team_id)
                AND voter.challenge_id = ballot.challenge_id
               JOIN ratings AS rating
                 ON rating.ballot_id = ballot.id
                AND rating.challenge_id = ballot.challenge_id
               WHERE ballot.challenge_id = challenges.id
                 AND ballot.dinner_id = dinner.id
                 AND (voter.role = 'jury' OR voter.team_id <> dinner.team_id)
               GROUP BY ballot.id
               HAVING COUNT(DISTINCT rating.category_id) = 5
             )
         )`,
    )
    .bind(now, now, dashboard.challenge.id)
    .run();
  if (result.meta.changes !== 1) {
    throw new RevealError(
      "REVEAL_CONFLICT",
      "Der Challenge-Status hat sich geändert. Bitte aktualisiere die Übersicht.",
    );
  }
}

export async function readRevealedResults(
  db: D1Database,
  challengeId?: string,
): Promise<RevealedResults> {
  const challenge = challengeId
    ? await db
        .prepare("SELECT id, name, status FROM challenges WHERE id = ?")
        .bind(challengeId)
        .first<ChallengeRow>()
    : await db
        .prepare("SELECT id, name, status FROM challenges ORDER BY created_at LIMIT 1")
        .first<ChallengeRow>();
  if (!challenge || challenge.status !== "revealed") {
    throw new ResultsUnavailableError("Die Ergebnisse sind noch nicht freigegeben.");
  }

  const [teamResult, categoryResult, scoreResult, voterCount] = await Promise.all([
    db
      .prepare(
        `SELECT team.id AS team_id, team.name AS team_name
         FROM teams AS team
         JOIN dinners AS dinner
           ON dinner.team_id = team.id AND dinner.challenge_id = team.challenge_id
         WHERE team.challenge_id = ?
         ORDER BY dinner.dinner_date, team.name`,
      )
      .bind(challenge.id)
      .all<TeamDinnerRow>(),
    db
      .prepare(
        "SELECT id, position, name, question FROM categories WHERE challenge_id = ? ORDER BY position",
      )
      .bind(challenge.id)
      .all<CategoryRow>(),
    db
      .prepare(
         `WITH complete_ballots AS (
           SELECT ballot.id, ballot.dinner_id
           FROM ballots AS ballot
           JOIN dinners AS ballot_dinner
             ON ballot_dinner.id = ballot.dinner_id
            AND ballot_dinner.challenge_id = ballot.challenge_id
           JOIN voters AS voter
             ON voter.id = COALESCE(ballot.voter_id, ballot.captain_team_id)
            AND voter.challenge_id = ballot.challenge_id
           JOIN ratings AS rating
             ON rating.ballot_id = ballot.id AND rating.challenge_id = ballot.challenge_id
           WHERE ballot.challenge_id = ?
             AND (voter.role = 'jury' OR voter.team_id <> ballot_dinner.team_id)
           GROUP BY ballot.id, ballot.dinner_id
           HAVING COUNT(DISTINCT rating.category_id) = 5
         )
         SELECT dinner.team_id,
                rating.category_id,
                SUM(rating.score) AS score_sum,
                COUNT(rating.score) AS rating_count
         FROM complete_ballots
         JOIN ratings AS rating ON rating.ballot_id = complete_ballots.id
         JOIN dinners AS dinner ON dinner.id = complete_ballots.dinner_id
         GROUP BY dinner.team_id, rating.category_id`,
      )
      .bind(challenge.id)
      .all<ScoreRow>(),
    db
      .prepare("SELECT COUNT(*) AS count FROM voters WHERE challenge_id = ?")
      .bind(challenge.id)
      .first<{ count: number }>(),
  ]);

  if (categoryResult.results.length !== 5 || teamResult.results.length === 0) {
    throw new ResultsUnavailableError("Die Ergebnisdaten sind nicht vollständig.");
  }

  const expectedRatingCount = Math.max(0, (voterCount?.count ?? 0) - 1);
  const scores = new Map(
    scoreResult.results.map((row) => [`${row.team_id}:${row.category_id}`, row]),
  );

  const categories = categoryResult.results.map((category) => {
    const standings = teamResult.results.map((team) => {
      const score = scores.get(`${team.team_id}:${category.id}`);
      if (!score || score.rating_count < 1) {
        throw new ResultsUnavailableError("Für mindestens ein Team fehlt ein Kategorieergebnis.");
      }
      return {
        teamName: team.team_name,
        scoreHundredths: roundScoreToHundredths(score.score_sum, score.rating_count),
        ratingCount: score.rating_count,
        expectedRatingCount,
      };
    });
    return { ...category, ranking: rankTeams(standings) };
  });

  const overall = teamResult.results.map((team) => {
    const teamScores = categoryResult.results.map((category) =>
      scores.get(`${team.team_id}:${category.id}`),
    );
    if (teamScores.some((score) => !score || score.rating_count < 1)) {
      throw new ResultsUnavailableError("Für mindestens ein Team fehlt ein Gesamtergebnis.");
    }
    const completeScores = teamScores as ScoreRow[];
    const ratingCount = completeScores[0].rating_count;
    if (completeScores.some((score) => score.rating_count !== ratingCount)) {
      throw new ResultsUnavailableError("Die Ergebnisdaten sind widersprüchlich.");
    }
    return {
      teamName: team.team_name,
      scoreHundredths: roundScoreToHundredths(
        completeScores.reduce((sum, score) => sum + score.score_sum, 0),
        ratingCount * categoryResult.results.length,
      ),
      ratingCount,
      expectedRatingCount,
    };
  });

  return {
    challenge: { id: challenge.id, name: challenge.name },
    categories: categories.map((category) => ({
      id: category.id,
      position: category.position,
      name: category.name,
      question: category.question,
      ranking: category.ranking,
    })),
    overall: rankTeams(overall),
  };
}
