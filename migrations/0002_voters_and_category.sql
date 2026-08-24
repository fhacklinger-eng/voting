PRAGMA defer_foreign_keys = ON;

CREATE TABLE voters (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('captain', 'jury')),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
  team_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, challenge_id),
  CHECK (
    (role = 'captain' AND team_id IS NOT NULL)
    OR (role = 'jury' AND team_id IS NULL)
  ),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, challenge_id)
    REFERENCES teams(id, challenge_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX one_captain_per_team
  ON voters(team_id)
  WHERE role = 'captain';

CREATE UNIQUE INDEX unique_jury_name_per_challenge
  ON voters(challenge_id, name_key)
  WHERE role = 'jury';

INSERT INTO voters (
  id, challenge_id, role, display_name, name_key, team_id, created_at, updated_at
)
SELECT team.id,
       team.challenge_id,
       'captain',
       team.captain_name,
       lower(trim(team.captain_name)),
       team.id,
       challenge.created_at,
       challenge.updated_at
FROM teams AS team
JOIN challenges AS challenge ON challenge.id = team.challenge_id;

CREATE TABLE ballots_v2 (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  dinner_id TEXT NOT NULL,
  captain_team_id TEXT,
  voter_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, challenge_id),
  UNIQUE (dinner_id, captain_team_id),
  CHECK (voter_id IS NOT NULL OR captain_team_id IS NOT NULL),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (dinner_id, challenge_id)
    REFERENCES dinners(id, challenge_id) ON DELETE CASCADE,
  FOREIGN KEY (captain_team_id, challenge_id)
    REFERENCES teams(id, challenge_id) ON DELETE CASCADE,
  FOREIGN KEY (voter_id, challenge_id)
    REFERENCES voters(id, challenge_id) ON DELETE CASCADE
);

INSERT INTO ballots_v2 (
  id, challenge_id, dinner_id, captain_team_id, voter_id, created_at, updated_at
)
SELECT id,
       challenge_id,
       dinner_id,
       captain_team_id,
       captain_team_id,
       created_at,
       updated_at
FROM ballots;

CREATE TABLE ratings_v2_data (
  ballot_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  score INTEGER NOT NULL
);

INSERT INTO ratings_v2_data (ballot_id, category_id, challenge_id, score)
SELECT ballot_id, category_id, challenge_id, score
FROM ratings;

DROP TABLE ratings;
DROP TABLE ballots;
ALTER TABLE ballots_v2 RENAME TO ballots;

CREATE UNIQUE INDEX one_ballot_per_voter_and_dinner
  ON ballots(dinner_id, COALESCE(voter_id, captain_team_id));

CREATE INDEX ballots_by_captain ON ballots(captain_team_id, dinner_id);
CREATE INDEX ballots_by_voter ON ballots(voter_id, dinner_id);

CREATE TABLE ratings (
  ballot_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  PRIMARY KEY (ballot_id, category_id),
  FOREIGN KEY (ballot_id, challenge_id)
    REFERENCES ballots(id, challenge_id) ON DELETE CASCADE,
  FOREIGN KEY (category_id, challenge_id)
    REFERENCES categories(id, challenge_id) ON DELETE CASCADE
);

INSERT INTO ratings (ballot_id, category_id, challenge_id, score)
SELECT ballot_id, category_id, challenge_id, score
FROM ratings_v2_data;

DROP TABLE ratings_v2_data;
CREATE INDEX ratings_by_category ON ratings(category_id, ballot_id);

UPDATE categories
SET name = 'Gesamterlebnis',
    name_key = 'gesamterlebnis',
    question = 'Wie stimmig war der Abend insgesamt?'
WHERE name = 'Urlaubslegende'
  AND question = 'Wie besonders war der gesamte Abend?';

PRAGMA foreign_key_check;
