import { useEffect, useState } from "react";
import { ApiRequestError, apiRequest, jsonRequest } from "../api";
import { Brand, dateLabel } from "../Brand";
import type { VoterSession } from "../Root";

interface Ballot {
  dinner: { id: string; teamName: string; date: string };
  categories: Array<{
    id: string;
    position: number;
    name: string;
    question: string;
  }>;
  ratings: Array<{ categoryId: string; score: number }>;
}

const SCORE_LABELS: Record<number, string> = {
  1: "Noch Luft im Topf",
  2: "Solider Versuch",
  3: "Hat geschmeckt",
  4: "Richtig stark",
  5: "Goldene Kochmütze",
};

export function CaptainBallot({
  dinnerId,
  identity,
  onBack,
  onSaved,
}: {
  dinnerId: string;
  identity: VoterSession;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ ballot: Ballot }>(
      `/api/voter/dinners/${encodeURIComponent(dinnerId)}/ballot`,
      { signal: controller.signal },
    )
      .then((payload) => {
        setBallot(payload.ballot);
        setRatings(Object.fromEntries(payload.ballot.ratings.map((rating) => [rating.categoryId, rating.score])));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (caught instanceof ApiRequestError && caught.code === "DINNER_NOT_OPEN") setClosed(true);
        setError(caught instanceof Error ? caught.message : "Die Bewertung konnte nicht geladen werden.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [dinnerId]);

  function select(categoryId: string, score: number) {
    setRatings((current) => ({ ...current, [categoryId]: score }));
    setMissing((current) => current.filter((id) => id !== categoryId));
    setError("");
  }

  async function save() {
    if (!ballot) return;
    const unanswered = ballot.categories
      .filter((category) => !ratings[category.id])
      .map((category) => category.id);
    if (unanswered.length > 0) {
      setMissing(unanswered);
      setError("Bitte bewerte alle fünf Kategorien.");
      requestAnimationFrame(() => document.getElementById(`category-${unanswered[0]}`)?.focus());
      return;
    }

    setSaving(true);
    setError("");
    try {
      await apiRequest(
        `/api/voter/dinners/${encodeURIComponent(dinnerId)}/ballot`,
        jsonRequest("PUT", {
          ratings: ballot.categories.map((category) => ({
            categoryId: category.id,
            score: ratings[category.id],
          })),
        }),
      );
      onSaved();
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === "DINNER_NOT_OPEN") {
        setClosed(true);
        setError("Der Abend wurde inzwischen geschlossen. Deine Auswahl bleibt hier sichtbar, wurde aber nicht gespeichert.");
      } else {
        setError(caught instanceof Error ? caught.message : "Die Bewertung konnte nicht gespeichert werden.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="ballot-shell">
      <header className="ballot-topbar">
        <button className="back-link" type="button" onClick={onBack}>← Übersicht</button>
        <Brand compact />
        <span className="identity-dot" title={`${identity.displayName} · ${identity.role === "jury" ? "Jury" : identity.teamName}`}>{identity.displayName.slice(0, 1).toLocaleUpperCase("de-DE")}</span>
      </header>

      {loading && <div className="loading" role="status">Die Stimmzettel werden verteilt …</div>}
      {!loading && !ballot && (
        <section className="ballot-message">
          <div className="banner banner--error" role="alert">{error}</div>
          <button className="button button--ghost" type="button" onClick={onBack}>Zur Übersicht</button>
        </section>
      )}
      {ballot && (
        <>
          <header className="ballot-heading">
            <time dateTime={ballot.dinner.date}>{dateLabel(ballot.dinner.date)}</time>
            <div className="eyebrow">Deine Bewertung</div>
            <h1>{ballot.dinner.teamName}</h1>
            <p>Aus dem Bauch heraus: 1 ist noch Luft im Topf, 5 die goldene Kochmütze.</p>
          </header>

          {error && <div className="banner banner--error ballot-banner" role="alert">{error}</div>}

          <form className="ballot-form" onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
            {ballot.categories.map((category, index) => {
              const selected = ratings[category.id];
              const invalid = missing.includes(category.id);
              return (
                <fieldset
                  className={`rating-card${invalid ? " rating-card--error" : ""}`}
                  id={`category-${category.id}`}
                  key={category.id}
                  tabIndex={-1}
                  aria-describedby={invalid ? `category-error-${category.id}` : undefined}
                >
                  <legend><span>{index + 1}</span><strong>{category.name}</strong></legend>
                  <p>{category.question}</p>
                  <div className="score-grid">
                    {[1, 2, 3, 4, 5].map((score) => (
                      <label className={`score-option${selected === score ? " is-selected" : ""}`} key={score}>
                        <input
                          type="radio"
                          name={`category-${category.id}`}
                          value={score}
                          checked={selected === score}
                          onChange={() => select(category.id, score)}
                          aria-label={`${score}: ${SCORE_LABELS[score]}`}
                        />
                        <span><strong>{score}</strong><small aria-hidden="true">{selected === score ? "✓" : ""}</small></span>
                      </label>
                    ))}
                  </div>
                  <div className="score-caption" aria-live="polite">
                    {selected ? `${selected} · ${SCORE_LABELS[selected]}` : "Noch keine Auswahl"}
                  </div>
                  {invalid && <div className="field-error" id={`category-error-${category.id}`}>Bitte hier noch eine Bewertung wählen.</div>}
                </fieldset>
              );
            })}

            <footer className="ballot-actions">
              <div><strong>{Object.keys(ratings).length} von {ballot.categories.length}</strong><span>Kategorien bewertet</span></div>
              <button className="button button--primary" type="submit" disabled={saving || closed}>
                {saving ? "Wird gespeichert …" : closed ? "Abend geschlossen" : ballot.ratings.length > 0 ? "Bewertung aktualisieren" : "Bewertung abgeben"}
              </button>
            </footer>
          </form>
        </>
      )}
    </main>
  );
}
