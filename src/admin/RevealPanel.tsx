import type { ErrorDetails } from "../api";
import { dateLabel } from "../Brand";

type MissingVote = NonNullable<ErrorDetails["missingVotes"]>[number];

export function RevealPanel({
  readiness,
  confirmation,
  busy,
  onReveal,
  onCancel,
}: {
  readiness: {
    canReveal: boolean;
    blocker: "DINNERS_NOT_CLOSED" | "TEAM_WITHOUT_VOTES" | null;
    blockedTeams: string[];
  };
  confirmation: MissingVote[] | null;
  busy: boolean;
  onReveal: (confirmMissing: boolean) => void;
  onCancel: () => void;
}) {
  if (confirmation) {
    return (
      <section className="reveal-card reveal-card--warning" aria-labelledby="reveal-title">
        <div className="reveal-card__seal" aria-hidden="true">!</div>
        <div className="eyebrow">Letzte Entscheidung</div>
        <h2 id="reveal-title">Es fehlen noch Stimmen</h2>
        <p>Diese Stimmen können nach der Auflösung nicht mehr abgegeben werden:</p>
        <ul className="missing-votes">
          {confirmation.map((vote) => (
            <li key={`${vote.dinnerId}:${vote.captainTeamName}`}>
              <strong>{vote.captainName}</strong>
              <span>für {vote.dinnerTeamName} · {dateLabel(vote.dinnerDate)}</span>
            </li>
          ))}
        </ul>
        <p className="irreversible-note">Die Auflösung ist endgültig. Bewertungen, Termine und Setup sind danach gesperrt.</p>
        <div className="button-row">
          <button className="button button--danger" type="button" disabled={busy} onClick={() => onReveal(true)}>
            {busy ? "Wird aufgelöst …" : "Endgültig auflösen"}
          </button>
          <button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Noch warten</button>
        </div>
      </section>
    );
  }

  if (readiness.blocker === "DINNERS_NOT_CLOSED") {
    return (
      <section className="reveal-card reveal-card--locked" aria-labelledby="reveal-title">
        <div className="reveal-card__seal" aria-hidden="true">⌛</div>
        <div className="eyebrow">Das große Finale</div>
        <h2 id="reveal-title">Noch nicht bereit</h2>
        <p>Erst wenn alle Kochabende geschlossen sind, kann die gemeinsame Auflösung beginnen.</p>
      </section>
    );
  }

  if (readiness.blocker === "TEAM_WITHOUT_VOTES") {
    return (
      <section className="reveal-card reveal-card--locked" aria-labelledby="reveal-title">
        <div className="reveal-card__seal" aria-hidden="true">⌛</div>
        <div className="eyebrow">Das große Finale</div>
        <h2 id="reveal-title">Mindestens eine Wertung fehlt</h2>
        <p>Für {readiness.blockedTeams.join(", ")} liegt noch keine vollständige Fremdbewertung vor. Diese Teams brauchen mindestens eine Stimme.</p>
      </section>
    );
  }

  return (
    <section className="reveal-card reveal-card--ready" aria-labelledby="reveal-title">
      <div className="reveal-card__rays" aria-hidden="true" />
      <div className="reveal-card__seal" aria-hidden="true">★</div>
      <div className="eyebrow">Alle Abende sind abgeschlossen</div>
      <h2 id="reveal-title">Bereit für die Siegerehrung?</h2>
      <p>Nach der Auflösung sehen alle Captains zunächst die Kategoriesieger. Danach kann gemeinsam der Gesamtsieger enthüllt werden.</p>
      <button className="button button--primary" type="button" disabled={busy || !readiness.canReveal} onClick={() => onReveal(false)}>
        {busy ? "Wird geprüft …" : "Ergebnis auflösen"}
      </button>
      <small>Endgültig – danach sind keine Änderungen mehr möglich.</small>
    </section>
  );
}

