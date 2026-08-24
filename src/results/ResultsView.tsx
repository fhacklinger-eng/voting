import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../api";

interface RankedTeam {
  place: number;
  teamName: string;
  score: number;
  ratingCount: number;
  expectedRatingCount: number;
}

interface Results {
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

function scoreLabel(score: number): string {
  return score.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function incompleteLabel(team: RankedTeam) {
  if (team.ratingCount === team.expectedRatingCount) return null;
  return <small>{team.ratingCount} von {team.expectedRatingCount} Bewertungen berücksichtigt</small>;
}

export function ResultsView({ endpoint }: { endpoint: string }) {
  const [results, setResults] = useState<Results | null>(null);
  const [showOverall, setShowOverall] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setShowOverall(false);
    apiRequest<{ results: Results }>(endpoint, { signal: controller.signal })
      .then((payload) => setResults(payload.results))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Die Ergebnisse konnten nicht geladen werden.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [endpoint, reload]);

  function revealOverall() {
    setShowOverall(true);
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (loading && !results) {
    return <div className="page-content"><div className="loading loading--inline" role="status">Die Punkte werden angerichtet …</div></div>;
  }
  if (!results) {
    return (
      <div className="page-content result-error">
        <div className="banner banner--error" role="alert">{error}</div>
        <button className="button button--primary" type="button" onClick={() => setReload((value) => value + 1)}>Erneut versuchen</button>
      </div>
    );
  }

  if (showOverall) {
    const winners = results.overall.filter((team) => team.place === 1);
    return (
      <div className="page-content results-view results-view--overall">
        <header className="overall-hero">
          <div className="confetti" aria-hidden="true"><span /><span /><span /><span /><span /></div>
          <div className="result-crown" aria-hidden="true">♛</div>
          <div className="eyebrow">{results.challenge.name}</div>
          <h1 ref={headingRef} tabIndex={-1}>{winners.length > 1 ? "Unsere Gesamtsieger" : "Unser Gesamtsieger"}</h1>
          <div className="overall-winners">
            {winners.map((winner) => <div key={winner.teamName}><strong>{winner.teamName}</strong>{incompleteLabel(winner)}</div>)}
          </div>
          <div className="overall-score">{scoreLabel(winners[0].score)} <span>Punkte</span></div>
        </header>

        <section className="overall-ranking" aria-labelledby="ranking-title">
          <div className="step-kicker">Die komplette Rangliste</div>
          <h2 id="ranking-title">Alle Teams</h2>
          <ol>
            {results.overall.map((team) => (
              <li className={team.place === 1 ? "is-winner" : ""} key={team.teamName}>
                <span className="rank-place">{team.place}</span>
                <span className="rank-team"><strong>{team.teamName}</strong>{incompleteLabel(team)}</span>
                <span className="rank-score">{scoreLabel(team.score)}</span>
              </li>
            ))}
          </ol>
          <button className="button button--ghost" type="button" onClick={() => { setShowOverall(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Kategoriesieger noch einmal ansehen</button>
        </section>
      </div>
    );
  }

  return (
    <div className="page-content results-view">
      <header className="results-heading">
        <div className="result-medallion" aria-hidden="true">★</div>
        <div className="eyebrow">{results.challenge.name}</div>
        <h1>Die Kategoriesieger</h1>
        <p>Fünf Disziplinen, fünfmal Ruhm und Ehre. Gleichstände teilen sich selbstverständlich den Lorbeer.</p>
      </header>

      {error && <div className="banner banner--error" role="alert">{error}</div>}
      <section className="category-results" aria-label="Sieger der fünf Kategorien">
        {results.categories.map((category) => {
          const winners = category.ranking.filter((team) => team.place === 1);
          return (
            <article className="category-result" key={category.id}>
              <div className="category-result__number">{category.position}</div>
              <div className="step-kicker">Kategorie</div>
              <h2>{category.name}</h2>
              <p>{category.question}</p>
              <div className="category-winners">
                {winners.map((winner) => (
                  <div key={winner.teamName}>
                    <strong>{winner.teamName}</strong>
                    <span>{scoreLabel(winner.score)}</span>
                    {incompleteLabel(winner)}
                  </div>
                ))}
              </div>
              <details className="category-ranking">
                <summary>Alle Platzierungen</summary>
                <ol>
                  {category.ranking.map((team) => (
                    <li key={team.teamName}>
                      <span>{team.place}. {team.teamName}{incompleteLabel(team)}</span>
                      <strong>{scoreLabel(team.score)}</strong>
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          );
        })}
      </section>

      <section className="overall-teaser">
        <div className="overall-teaser__plate" aria-hidden="true"><span>?</span></div>
        <div className="eyebrow">Der letzte Gang</div>
        <h2>Wer holt die goldene Kochmütze?</h2>
        <p>Die Kategorien sind entschieden. Jetzt fehlt nur noch der Gesamtsieg.</p>
        <button className="button button--primary" type="button" onClick={revealOverall}>Gesamtsieger enthüllen</button>
      </section>
    </div>
  );
}
