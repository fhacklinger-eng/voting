export interface BallotRating {
  categoryId: string;
  score: number;
}

export interface CompleteBallot {
  challengeId: string;
  dinnerId: string;
  voterId: string;
  ratings: BallotRating[];
}

export class BallotValidationError extends Error {}
export class BallotWriteConflictError extends Error {}

function ballotId(input: CompleteBallot): string {
  return `ballot:${input.dinnerId}:${input.voterId}`;
}

function validateShape(input: CompleteBallot): void {
  if (input.ratings.length !== 5) {
    throw new BallotValidationError("Eine Bewertung benötigt genau fünf Werte.");
  }

  const categoryIds = new Set(input.ratings.map((rating) => rating.categoryId));
  if (categoryIds.size !== 5) {
    throw new BallotValidationError("Jede Kategorie darf nur einmal vorkommen.");
  }

  if (
    input.ratings.some(
      (rating) => !Number.isInteger(rating.score) || rating.score < 1 || rating.score > 5,
    )
  ) {
    throw new BallotValidationError("Punktwerte müssen ganze Zahlen von 1 bis 5 sein.");
  }
}

const writableContext = `
  EXISTS (
    SELECT 1
    FROM dinners AS dinner
    JOIN challenges AS challenge ON challenge.id = dinner.challenge_id
    JOIN voters AS voter ON voter.challenge_id = dinner.challenge_id
    WHERE dinner.id = ?
      AND dinner.challenge_id = ?
      AND dinner.status = 'open'
      AND challenge.status <> 'revealed'
      AND voter.id = ?
      AND (voter.role = 'jury' OR voter.team_id <> dinner.team_id)
  )
`;

/**
 * Persists a complete ballot as one D1 batch. D1 executes batch statements as
 * a transaction, so a failed rating insert also rolls back the ballot upsert
 * and the preceding rating delete.
 */
export async function persistCompleteBallot(
  db: D1Database,
  input: CompleteBallot,
): Promise<void> {
  validateShape(input);

  const id = ballotId(input);
  const now = new Date().toISOString();
  const contextBindings = [input.dinnerId, input.challengeId, input.voterId];

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO ballots (
          id, challenge_id, dinner_id, captain_team_id, voter_id, created_at, updated_at
        )
        SELECT ?, ?, ?,
               (SELECT team_id FROM voters WHERE id = ? AND challenge_id = ?),
               ?, ?, ?
        WHERE ${writableContext}
        ON CONFLICT DO UPDATE SET
          voter_id = excluded.voter_id,
          updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        input.challengeId,
        input.dinnerId,
        input.voterId,
        input.challengeId,
        input.voterId,
        now,
        now,
        ...contextBindings,
      ),
    db
      .prepare(`DELETE FROM ratings WHERE ballot_id = ? AND ${writableContext}`)
      .bind(id, ...contextBindings),
    ...input.ratings.map((rating) =>
      db
        .prepare(
          `INSERT INTO ratings (ballot_id, category_id, challenge_id, score)
           SELECT ?, ?, ?, ?
           WHERE ${writableContext}`,
        )
        .bind(
          id,
          rating.categoryId,
          input.challengeId,
          rating.score,
          ...contextBindings,
        ),
    ),
  ];

  const results = await db.batch(statements);
  if (results[0].meta.changes !== 1) {
    throw new BallotWriteConflictError("Der Kochabend ist nicht zur Bewertung geöffnet.");
  }
}

export async function saveCompleteBallot(
  db: D1Database,
  input: CompleteBallot,
): Promise<void> {
  validateShape(input);

  const context = await db
    .prepare(
      `SELECT dinner.team_id AS dinner_team_id,
              dinner.status AS dinner_status,
              challenge.status AS challenge_status,
              voter.role AS voter_role,
              voter.team_id AS voter_team_id
       FROM dinners AS dinner
       JOIN challenges AS challenge ON challenge.id = dinner.challenge_id
       JOIN voters AS voter ON voter.challenge_id = dinner.challenge_id
       WHERE dinner.id = ? AND dinner.challenge_id = ? AND voter.id = ?`,
    )
    .bind(input.dinnerId, input.challengeId, input.voterId)
    .first<{
      dinner_team_id: string;
      dinner_status: string;
      challenge_status: string;
      voter_role: "captain" | "jury";
      voter_team_id: string | null;
    }>();

  if (!context || context.dinner_status !== "open" || context.challenge_status === "revealed") {
    throw new BallotWriteConflictError("Der Kochabend ist nicht zur Bewertung geöffnet.");
  }
  if (context.voter_role === "captain" && context.dinner_team_id === context.voter_team_id) {
    throw new BallotValidationError("Das eigene Team darf nicht bewertet werden.");
  }

  const categories = await db
    .prepare("SELECT id FROM categories WHERE challenge_id = ? ORDER BY position")
    .bind(input.challengeId)
    .all<{ id: string }>();
  const expected = new Set(categories.results.map((category) => category.id));
  const provided = new Set(input.ratings.map((rating) => rating.categoryId));

  if (
    expected.size !== 5 ||
    provided.size !== expected.size ||
    [...provided].some((id) => !expected.has(id))
  ) {
    throw new BallotValidationError("Die Bewertung passt nicht zu den fünf Kategorien.");
  }

  await persistCompleteBallot(db, input);
}
