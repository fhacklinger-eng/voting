import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { apiRequest } from "../api";
import { Brand, dateLabel } from "../Brand";
import type { VoterSession } from "../Root";
import { ResultsView } from "../results/ResultsView";
import { CaptainBallot } from "./CaptainBallot";

type DinnerStatus = "upcoming" | "open" | "closed";
type TaskStatus = "own" | "open" | "completed" | "upcoming" | "closed";

interface CaptainDinner {
  id: string;
  teamId: string;
  teamName: string;
  date: string;
  dinnerStatus: DinnerStatus;
  isOwn: boolean;
  hasBallot: boolean;
  taskStatus: TaskStatus;
}

interface CaptainDashboard {
  identity: VoterSession;
  progress: { completed: number; total: number };
  dinners: CaptainDinner[];
}

const taskLabel: Record<TaskStatus, string> = {
  own: "Euer Kochabend",
  open: "Jetzt abstimmen",
  completed: "Abgegeben",
  upcoming: "Kommt noch",
  closed: "Geschlossen",
};

export function CaptainArea({
  initialIdentity,
  onLogout,
}: {
  initialIdentity: VoterSession;
  onLogout: () => Promise<void>;
}) {
  const [dashboard, setDashboard] = useState<CaptainDashboard | null>(null);
  const [selectedDinnerId, setSelectedDinnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ dashboard: CaptainDashboard }>("/api/voter/dashboard");
      setDashboard(payload.dashboard);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die Übersicht konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function savedBallot() {
    await loadDashboard();
    setSelectedDinnerId(null);
    setNotice("Bewertung gespeichert. Solange der Abend offen ist, kannst du sie noch ändern.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const identity = dashboard?.identity ?? initialIdentity;
  if (selectedDinnerId) {
    return (
      <CaptainBallot
        dinnerId={selectedDinnerId}
        identity={identity}
        onBack={() => setSelectedDinnerId(null)}
        onSaved={() => void savedBallot()}
      />
    );
  }

  const openDinner = dashboard?.dinners.find((dinner) => dinner.dinnerStatus === "open");
  const progress = dashboard?.progress ?? { completed: 0, total: 0 };
  const progressWidth = progress.total === 0 ? 0 : (progress.completed / progress.total) * 100;

  return (
    <main className="app-shell captain-shell">
      <header className="app-header">
        <Brand compact />
        <div className="app-header__actions">
          <span className="identity-pill"><strong>{identity.displayName}</strong><small>{identity.role === "jury" ? "Jury" : identity.teamName}</small></span>
          <button className="icon-button" type="button" onClick={() => void onLogout()} aria-label="Abmelden" title="Abmelden">↗</button>
        </div>
      </header>

      {dashboard?.identity.challengeStatus === "revealed" ? (
        <ResultsView endpoint="/api/voter/results" />
      ) : (
        <div className="page-content">
          <header className="captain-heading">
            <div className="eyebrow">{identity.challengeName}</div>
            <h1>Ciao, {identity.displayName}!</h1>
            <p>{identity.role === "jury" ? <>Du stimmst als <strong>Jury</strong> ab.</> : <>Deine Stimme zählt für <strong>{identity.teamName}</strong>.</>}</p>
          </header>

          {notice && <div className="banner banner--success" role="status">✓ {notice}</div>}
          {error && <div className="banner banner--error" role="alert">{error}</div>}

          {loading && !dashboard ? <div className="loading loading--inline" role="status">Die Abende werden geladen …</div> : dashboard && (
            <>
            <section className={`current-card${openDinner ? " current-card--open" : ""}`} aria-labelledby="current-title">
              <div className="current-card__sun" aria-hidden="true" />
              {!openDinner && (
                <>
                  <div className="eyebrow">Gerade am Tisch</div>
                  <h2 id="current-title">Noch keine Abstimmung offen</h2>
                  <p>Sobald die Orga einen Kochabend öffnet, erscheint er genau hier.</p>
                </>
              )}
              {openDinner?.isOwn && (
                <>
                  <div className="eyebrow">Heute kocht ihr</div>
                  <h2 id="current-title">{openDinner.teamName} ist dran</h2>
                  <p>Das eigene Essen bleibt außer Konkurrenz – für euch gibt es heute nichts abzustimmen.</p>
                </>
              )}
              {openDinner && !openDinner.isOwn && (
                <>
                  <time dateTime={openDinner.date}>{dateLabel(openDinner.date)}</time>
                  <div className="eyebrow">Jetzt bewerten</div>
                  <h2 id="current-title">{openDinner.teamName}</h2>
                  <p>Fünf Kategorien, fünf schnelle Entscheidungen. Deine Auswahl bleibt bis zum Schließen änderbar.</p>
                  <button className="button button--primary" type="button" onClick={() => setSelectedDinnerId(openDinner.id)}>
                    {openDinner.hasBallot ? "Bewertung ändern" : "Bewertung starten"}
                  </button>
                </>
              )}
            </section>

            <section className="captain-progress" aria-labelledby="progress-title">
              <div><div className="step-kicker">Dein Fortschritt</div><h2 id="progress-title">{progress.completed} von {progress.total} erledigt</h2></div>
              <span className="progress-ring" style={{ "--progress": `${progressWidth * 3.6}deg` } as CSSProperties}><strong>{progress.completed}</strong><small>/{progress.total}</small></span>
            </section>

            <section className="captain-timeline" aria-labelledby="timeline-title">
              <div className="step-kicker">Alle Kochabende</div>
              <h2 id="timeline-title">Die Menüfolge</h2>
              <ol>
                {dashboard.dinners.map((dinner) => (
                  <li className={`captain-dinner captain-dinner--${dinner.taskStatus}`} key={dinner.id}>
                    <span className="captain-dinner__dot" aria-hidden="true">{dinner.taskStatus === "completed" ? "✓" : ""}</span>
                    <div><time dateTime={dinner.date}>{dateLabel(dinner.date)}</time><strong>{dinner.teamName}</strong></div>
                    <span className="captain-dinner__state">{taskLabel[dinner.taskStatus]}</span>
                    {dinner.dinnerStatus === "open" && !dinner.isOwn && (
                      <button className="text-button" type="button" onClick={() => setSelectedDinnerId(dinner.id)}>
                        {dinner.hasBallot ? "Ändern" : "Bewerten"}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
