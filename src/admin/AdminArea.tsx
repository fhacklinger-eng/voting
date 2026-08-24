import { useCallback, useEffect, useState } from "react";
import { ChallengeSetup } from "../App";
import { ApiRequestError, apiRequest, jsonRequest } from "../api";
import type { ErrorDetails } from "../api";
import { Brand, dateLabel } from "../Brand";
import { ResultsView } from "../results/ResultsView";
import { CaptainLinks } from "./CaptainLinks";
import { RevealPanel } from "./RevealPanel";

type ChallengeStatus = "preparation" | "running" | "revealed";
type DinnerStatus = "upcoming" | "open" | "closed";
type ParticipationStatus = "submitted" | "pending" | "not_eligible";

interface Dinner {
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
    role: "captain" | "jury";
    displayName: string;
    teamId: string | null;
    teamName: string | null;
    status: ParticipationStatus;
  }>;
}

interface Dashboard {
  challenge: null | { id: string; name: string; status: ChallengeStatus };
  dinners: Dinner[];
  reveal: null | {
    canReveal: boolean;
    blocker: "DINNERS_NOT_CLOSED" | "TEAM_WITHOUT_VOTES" | null;
    blockedTeams: string[];
  };
}

type AdminView = "dinners" | "links" | "setup";

const challengeStatusLabel: Record<ChallengeStatus, string> = {
  preparation: "Vorbereitung",
  running: "Challenge läuft",
  revealed: "Aufgelöst",
};

const dinnerStatusLabel: Record<DinnerStatus, string> = {
  upcoming: "Kommt noch",
  open: "Abstimmung offen",
  closed: "Abgeschlossen",
};

const participationLabel: Record<ParticipationStatus, string> = {
  submitted: "Abgegeben",
  pending: "Noch offen",
  not_eligible: "Kocht selbst",
};

export function AdminArea({ onLogout }: { onLogout: () => Promise<void> }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [view, setView] = useState<AdminView>("dinners");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<null | {
    dinnerId: string;
    missingVoters: NonNullable<ErrorDetails["missingVoters"]>;
  }>(null);
  const [revealConfirmation, setRevealConfirmation] = useState<
    ErrorDetails["missingVotes"] | null
  >(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiRequest<{ dashboard: Dashboard }>("/api/admin/dashboard");
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

  async function finishSetup() {
    setView("dinners");
    await loadDashboard();
  }

  async function changeDinner(
    dinner: Dinner,
    action: "open" | "close" | "reopen",
    confirmMissing = false,
  ) {
    setBusy(`${dinner.id}:${action}`);
    setError("");
    setNotice("");
    if (confirmMissing) setConfirmation(null);
    try {
      const init = action === "close"
        ? jsonRequest("POST", { confirmMissing })
        : { method: "POST" };
      const payload = await apiRequest<{ dashboard: Dashboard }>(
        `/api/admin/dinners/${encodeURIComponent(dinner.id)}/${action}`,
        init,
      );
      setDashboard(payload.dashboard);
      setNotice(
        action === "open"
          ? `${dinner.teamName} ist jetzt zur Bewertung geöffnet.`
          : action === "close"
            ? `${dinner.teamName} wurde geschlossen.`
            : `${dinner.teamName} ist wieder geöffnet. Die bisherigen Stimmen sind erhalten.`,
      );
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        caught.code === "MISSING_VOTES_CONFIRMATION_REQUIRED"
      ) {
        setConfirmation({
          dinnerId: dinner.id,
          missingVoters: caught.details.missingVoters ?? [],
        });
      } else {
        setError(caught instanceof Error ? caught.message : "Die Aktion konnte nicht ausgeführt werden.");
      }
    } finally {
      setBusy("");
    }
  }

  async function revealResults(confirmMissing: boolean) {
    setBusy("reveal");
    setError("");
    setNotice("");
    try {
      await apiRequest("/api/admin/reveal", jsonRequest("POST", { confirmMissing }));
      setRevealConfirmation(null);
      await loadDashboard();
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        caught.code === "MISSING_VOTES_CONFIRMATION_REQUIRED"
      ) {
        setRevealConfirmation(caught.details.missingVotes ?? []);
      } else {
        setError(caught instanceof Error ? caught.message : "Die Challenge konnte nicht aufgelöst werden.");
      }
    } finally {
      setBusy("");
    }
  }

  if (loading && !dashboard) {
    return <main className="shell shell--centered"><Brand /><div className="loading" role="status">Die Abende werden angerichtet …</div></main>;
  }

  if (!dashboard?.challenge) {
    if (error) {
      return (
        <main className="shell shell--centered">
          <section className="access-card"><Brand /><div className="banner banner--error" role="alert">{error}</div>
            <button className="button button--primary" type="button" onClick={() => void loadDashboard()}>Erneut versuchen</button>
          </section>
        </main>
      );
    }
    return <ChallengeSetup onDone={() => void finishSetup()} />;
  }

  const challenge = dashboard.challenge;
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand compact />
        <div className="app-header__actions">
          <span className="role-pill">Orga</span>
          <button className="icon-button" type="button" onClick={() => void onLogout()} aria-label="Abmelden" title="Abmelden">↗</button>
        </div>
      </header>

      <nav className="tab-nav" aria-label="Organisation">
        <button type="button" className={view === "dinners" ? "is-active" : ""} onClick={() => setView("dinners")}>{challenge.status === "revealed" ? "Ergebnis" : "Abende"}</button>
        <button type="button" className={view === "links" ? "is-active" : ""} onClick={() => setView("links")}>Zugänge</button>
        <button type="button" className={view === "setup" ? "is-active" : ""} onClick={() => setView("setup")}>Setup</button>
      </nav>

      {view === "setup" && <ChallengeSetup onDone={() => void finishSetup()} />}
      {view === "links" && <CaptainLinks />}
      {view === "dinners" && challenge.status === "revealed" && (
        <ResultsView endpoint="/api/admin/results" />
      )}
      {view === "dinners" && challenge.status !== "revealed" && (
        <div className="page-content">
          <header className="hero-heading">
            <div>
              <div className="eyebrow">Abendsteuerung</div>
              <h1>{challenge.name}</h1>
            </div>
            <span className={`state-pill state-pill--${challenge.status}`}>
              {challengeStatusLabel[challenge.status]}
            </span>
          </header>

          {notice && <div className="banner banner--success" role="status">✓ {notice}</div>}
          {error && <div className="banner banner--error" role="alert">{error}</div>}

          <div className="timeline" aria-label="Kochabende in Reihenfolge">
            {dashboard.dinners.map((dinner, index) => {
              const confirmationForDinner = confirmation?.dinnerId === dinner.id;
              const isBusy = busy.startsWith(`${dinner.id}:`);
              return (
                <article className={`dinner-card dinner-card--${dinner.status}`} key={dinner.id}>
                  <div className="timeline__number" aria-hidden="true">{index + 1}</div>
                  <div className="dinner-card__body">
                    <header className="dinner-card__header">
                      <div><time dateTime={dinner.date}>{dateLabel(dinner.date)}</time><h2>{dinner.teamName}</h2><p>Captain {dinner.captainName}</p></div>
                      <span className={`dinner-status dinner-status--${dinner.status}`}>{dinnerStatusLabel[dinner.status]}</span>
                    </header>

                    <div className="vote-meter" aria-label={`${dinner.submittedVotes} von ${dinner.expectedVotes} Stimmen abgegeben`}>
                      <span><strong>{dinner.submittedVotes}/{dinner.expectedVotes}</strong> Stimmen</span>
                      <span className="vote-meter__track"><span style={{ width: `${dinner.expectedVotes === 0 ? 100 : (dinner.submittedVotes / dinner.expectedVotes) * 100}%` }} /></span>
                    </div>

                    <details className="participation" open={dinner.status === "open"}>
                      <summary>Teilnahme ansehen</summary>
                      <ul>
                        {dinner.participants.map((participant) => (
                          <li key={participant.voterId}>
                            <span><strong>{participant.displayName}</strong><small>{participant.role === "jury" ? "Jury" : participant.teamName}</small></span>
                            <span className={`participation__state participation__state--${participant.status}`}>
                              {participationLabel[participant.status]}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>

                    {confirmationForDinner && (
                      <div className="confirmation" role="alert">
                        <strong>Noch nicht alle haben abgestimmt.</strong>
                        <p>Es fehlen: {confirmation.missingVoters.map((voter) => voter.role === "jury" ? `${voter.displayName} (Jury)` : `${voter.displayName} (${voter.teamName})`).join(", ") || "mindestens eine Stimme"}. Trotzdem schließen?</p>
                        <div className="button-row">
                          <button className="button button--danger" type="button" disabled={isBusy} onClick={() => void changeDinner(dinner, "close", true)}>Trotzdem schließen</button>
                          <button className="button button--ghost" type="button" onClick={() => setConfirmation(null)}>Noch offen lassen</button>
                        </div>
                      </div>
                    )}

                    {!confirmationForDinner && challenge.status !== "revealed" && (
                      <div className="dinner-card__actions">
                        {dinner.canOpen && <button className="button button--primary" type="button" disabled={isBusy} onClick={() => void changeDinner(dinner, "open")}>{isBusy ? "Wird geöffnet …" : "Abstimmung öffnen"}</button>}
                        {dinner.canClose && <button className="button button--primary" type="button" disabled={isBusy} onClick={() => void changeDinner(dinner, "close")}>{isBusy ? "Wird geschlossen …" : "Abstimmung schließen"}</button>}
                        {dinner.canReopen && <button className="button button--ghost" type="button" disabled={isBusy} onClick={() => void changeDinner(dinner, "reopen")}>{isBusy ? "Wird geöffnet …" : "Wieder öffnen"}</button>}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {dashboard.reveal && (
            <RevealPanel
              readiness={dashboard.reveal}
              confirmation={revealConfirmation ?? null}
              busy={busy === "reveal"}
              onReveal={(confirmMissing) => void revealResults(confirmMissing)}
              onCancel={() => setRevealConfirmation(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
