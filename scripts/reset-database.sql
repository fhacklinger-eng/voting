PRAGMA foreign_keys = ON;

DELETE FROM challenges;

PRAGMA foreign_key_check;

SELECT
  (SELECT COUNT(*) FROM challenges) AS challenges,
  (SELECT COUNT(*) FROM teams) AS teams,
  (SELECT COUNT(*) FROM dinners) AS dinners,
  (SELECT COUNT(*) FROM ballots) AS ballots,
  (SELECT COUNT(*) FROM ratings) AS ratings,
  (SELECT COUNT(*) FROM categories) AS categories;
