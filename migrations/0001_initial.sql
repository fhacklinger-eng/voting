PRAGMA foreign_keys = ON;

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  status TEXT NOT NULL DEFAULT 'preparation'
    CHECK (status IN ('preparation', 'running', 'revealed')),
  revealed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'revealed' AND revealed_at IS NOT NULL)
    OR (status <> 'revealed' AND revealed_at IS NULL)
  )
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
  question TEXT NOT NULL CHECK (length(trim(question)) > 0),
  UNIQUE (id, challenge_id),
  UNIQUE (challenge_id, position),
  UNIQUE (challenge_id, name_key),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_key TEXT NOT NULL CHECK (length(trim(name_key)) > 0),
  captain_name TEXT NOT NULL CHECK (length(trim(captain_name)) > 0),
  UNIQUE (id, challenge_id),
  UNIQUE (challenge_id, name_key),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
);

CREATE TABLE dinners (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  dinner_date TEXT NOT NULL CHECK (dinner_date GLOB '????-??-??'),
  status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'open', 'closed')),
  opened_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, challenge_id),
  UNIQUE (team_id),
  UNIQUE (challenge_id, dinner_date),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, challenge_id)
    REFERENCES teams(id, challenge_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX one_open_dinner_per_challenge
  ON dinners(challenge_id)
  WHERE status = 'open';

CREATE TABLE ballots (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  dinner_id TEXT NOT NULL,
  captain_team_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, challenge_id),
  UNIQUE (dinner_id, captain_team_id),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (dinner_id, challenge_id)
    REFERENCES dinners(id, challenge_id) ON DELETE CASCADE,
  FOREIGN KEY (captain_team_id, challenge_id)
    REFERENCES teams(id, challenge_id) ON DELETE CASCADE
);

CREATE INDEX ballots_by_captain ON ballots(captain_team_id, dinner_id);

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

CREATE INDEX ratings_by_category ON ratings(category_id, ballot_id);
