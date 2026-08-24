import { useEffect, useMemo, useState } from "react";

const DEFAULT_CATEGORIES = [
  { name: "Nachschlag-Faktor", question: "Wie lecker war’s?" },
  { name: "Das Auge isst mit", question: "Wie appetitlich sah das Essen aus?" },
  { name: "Küchen-Coup", question: "Wie kreativ und stimmig war das Menü?" },
  { name: "Punktlandung", question: "Haben Garpunkt, Temperatur und Timing gepasst?" },
  { name: "Gesamterlebnis", question: "Wie stimmig war der Abend insgesamt?" },
];

type ChallengeStatus = "preparation" | "running" | "revealed";
type DinnerStatus = "upcoming" | "open" | "closed";

interface ChallengeDto {
  id: string;
  name: string;
  status: ChallengeStatus;
  teams: Array<{
    id: string;
    name: string;
    captainName: string;
    dinner: { id: string; date: string; status: DinnerStatus };
  }>;
  juryMembers: Array<{ id: string; name: string }>;
  categories: Array<{
    id: string;
    position: number;
    name: string;
    question: string;
  }>;
}

interface SetupForm {
  name: string;
  teams: Array<{
    id?: string;
    name: string;
    captainName: string;
    dinnerDate: string;
    dinnerStatus: DinnerStatus;
  }>;
  juryMembers: Array<{ id?: string; name: string }>;
  categories: Array<{ id?: string; name: string; question: string }>;
}

interface ApiError {
  error?: { message?: string; fieldErrors?: Record<string, string> };
}

const emptyTeam = () => ({
  name: "",
  captainName: "",
  dinnerDate: "",
  dinnerStatus: "upcoming" as const,
});

const emptyForm = (): SetupForm => ({
  name: "",
  teams: [emptyTeam(), emptyTeam(), emptyTeam()],
  juryMembers: [],
  categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
});

function formFromChallenge(challenge: ChallengeDto): SetupForm {
  return {
    name: challenge.name,
    teams: challenge.teams.map((team) => ({
      id: team.id,
      name: team.name,
      captainName: team.captainName,
      dinnerDate: team.dinner.date,
      dinnerStatus: team.dinner.status,
    })),
    juryMembers: challenge.juryMembers.map((member) => ({ ...member })),
    categories: challenge.categories.map((category) => ({
      id: category.id,
      name: category.name,
      question: category.question,
    })),
  };
}

function dateLabel(value: string): string {
  if (!value) return "Noch kein Termin";
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function clientErrors(form: SetupForm, step?: number): Record<string, string> {
  const errors: Record<string, string> = {};
  if ((!step || step === 1) && !form.name.trim()) {
    errors.name = "Bitte gib der Challenge einen Namen.";
  }

  if (!step || step === 2) {
    if (form.teams.length < 3) errors.teams = "Lege mindestens drei Teams an.";
    const names = new Map<string, number>();
    const dates = new Map<string, number>();
    form.teams.forEach((team, index) => {
      if (!team.name.trim()) errors[`teams.${index}.name`] = "Bitte gib einen Teamnamen ein.";
      if (!team.captainName.trim()) {
        errors[`teams.${index}.captainName`] = "Bitte gib den Captain an.";
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(team.dinnerDate)) {
        errors[`teams.${index}.dinnerDate`] = "Bitte wähle ein Datum.";
      }

      const name = normalize(team.name);
      const duplicateName = names.get(name);
      if (name && duplicateName !== undefined) {
        errors[`teams.${duplicateName}.name`] = "Teamnamen müssen eindeutig sein.";
        errors[`teams.${index}.name`] = "Teamnamen müssen eindeutig sein.";
      } else if (name) names.set(name, index);

      const duplicateDate = dates.get(team.dinnerDate);
      if (team.dinnerDate && duplicateDate !== undefined) {
        errors[`teams.${duplicateDate}.dinnerDate`] = "Jeder Abend braucht ein eigenes Datum.";
        errors[`teams.${index}.dinnerDate`] = "Jeder Abend braucht ein eigenes Datum.";
      } else if (team.dinnerDate) dates.set(team.dinnerDate, index);
    });

    const juryNames = new Map<string, number>();
    form.juryMembers.forEach((member, index) => {
      if (!member.name.trim()) {
        errors[`juryMembers.${index}.name`] = "Bitte gib einen Namen für das Jury-Mitglied ein.";
      }
      const name = normalize(member.name);
      const duplicate = juryNames.get(name);
      if (name && duplicate !== undefined) {
        errors[`juryMembers.${duplicate}.name`] = "Jury-Namen müssen eindeutig sein.";
        errors[`juryMembers.${index}.name`] = "Jury-Namen müssen eindeutig sein.";
      } else if (name) juryNames.set(name, index);
    });
  }

  if (!step || step === 3) {
    const names = new Map<string, number>();
    form.categories.forEach((category, index) => {
      if (!category.name.trim()) {
        errors[`categories.${index}.name`] = "Bitte gib einen Kategorienamen ein.";
      }
      if (!category.question.trim()) {
        errors[`categories.${index}.question`] = "Bitte ergänze die Leitfrage.";
      }
      const name = normalize(category.name);
      const duplicate = names.get(name);
      if (name && duplicate !== undefined) {
        errors[`categories.${duplicate}.name`] = "Kategorienamen müssen eindeutig sein.";
        errors[`categories.${index}.name`] = "Kategorienamen müssen eindeutig sein.";
      } else if (name) names.set(name, index);
    });
  }

  return errors;
}

function focusFirstError(errors: Record<string, string>): void {
  const first = Object.keys(errors)[0];
  if (!first) return;
  requestAnimationFrame(() =>
    document.getElementById(`field-${first.replaceAll(".", "-")}`)?.focus(),
  );
}

export function ChallengeSetup({ onDone }: { onDone?: () => void }) {
  const [form, setForm] = useState<SetupForm>(emptyForm);
  const [challenge, setChallenge] = useState<ChallengeDto | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/challenge", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("LOAD_FAILED");
        return (await response.json()) as { challenge: ChallengeDto | null };
      })
      .then(({ challenge: loaded }) => {
        if (loaded) {
          setChallenge(loaded);
          setForm(formFromChallenge(loaded));
          setShowSummary(true);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPageError("Die Challenge konnte nicht geladen werden. Bitte lade die Seite erneut.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const orderedTeams = useMemo(
    () => [...form.teams].sort((left, right) => left.dinnerDate.localeCompare(right.dinnerDate)),
    [form.teams],
  );
  const status = challenge?.status ?? "preparation";
  const fullyLocked = status === "revealed";
  const setupLocked = status !== "preparation";

  function clearError(key: string): void {
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPageError("");
    setNotice("");
  }

  function updateTeam(index: number, key: "name" | "captainName" | "dinnerDate", value: string) {
    setForm((current) => ({
      ...current,
      teams: current.teams.map((team, teamIndex) =>
        teamIndex === index ? { ...team, [key]: value } : team,
      ),
    }));
    clearError(`teams.${index}.${key}`);
  }

  function updateCategory(index: number, key: "name" | "question", value: string) {
    setForm((current) => ({
      ...current,
      categories: current.categories.map((category, categoryIndex) =>
        categoryIndex === index ? { ...category, [key]: value } : category,
      ),
    }));
    clearError(`categories.${index}.${key}`);
  }

  function updateJuryMember(index: number, value: string) {
    setForm((current) => ({
      ...current,
      juryMembers: current.juryMembers.map((member, memberIndex) =>
        memberIndex === index ? { ...member, name: value } : member,
      ),
    }));
    clearError(`juryMembers.${index}.name`);
  }

  function moveTo(nextStep: number): void {
    const errors = clientErrors(form, step);
    if (nextStep > step && Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      focusFirstError(errors);
      return;
    }
    setFieldErrors({});
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveConfiguration() {
    const errors = clientErrors(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const first = Object.keys(errors)[0];
      if (first === "name") setStep(1);
      else if (first.startsWith("teams") || first.startsWith("juryMembers")) setStep(2);
      else {
        setStep(3);
        setCategoriesOpen(true);
      }
      focusFirstError(errors);
      return;
    }

    setSaving(true);
    setPageError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/challenge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          teams: form.teams.map(({ dinnerStatus: _dinnerStatus, ...team }) => team),
          juryMembers: form.juryMembers,
          categories: form.categories,
        }),
      });
      const payload = (await response.json()) as { challenge?: ChallengeDto } & ApiError;
      if (!response.ok || !payload.challenge) {
        if (payload.error?.fieldErrors) {
          setFieldErrors(payload.error.fieldErrors);
          const first = Object.keys(payload.error.fieldErrors)[0];
          if (first === "name") setStep(1);
          else if (first?.startsWith("teams") || first?.startsWith("juryMembers")) setStep(2);
          else {
            setStep(3);
            setCategoriesOpen(true);
          }
          focusFirstError(payload.error.fieldErrors);
        }
        throw new Error(payload.error?.message ?? "Die Challenge konnte nicht gespeichert werden.");
      }

      setChallenge(payload.challenge);
      setForm(formFromChallenge(payload.challenge));
      setFieldErrors({});
      setNotice(
        payload.challenge.status === "preparation"
          ? "Alles ist gespeichert. Als Nächstes kannst du die persönlichen Zugänge teilen."
          : "Die geänderten Termine sind gespeichert.",
      );
      setShowSummary(true);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "Die Challenge konnte nicht gespeichert werden. Bitte versuche es erneut.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="shell shell--setup"><div className="loading" role="status">Der Tisch wird gedeckt …</div></main>;
  }

  if (showSummary) {
    return (
      <main className="shell shell--setup">
        <section className="setup-card" aria-labelledby="page-title">
          <header className="page-header">
            <div><div className="eyebrow">Cucina Challenge</div><h1 id="page-title">{form.name}</h1></div>
            <span className={`state-pill state-pill--${status}`}>
              {status === "preparation" ? "Vorbereitung" : status === "running" ? "Läuft" : "Aufgelöst"}
            </span>
          </header>
          {notice && <div className="banner banner--success" role="status">✓ {notice}</div>}
          {pageError && <div className="banner banner--error" role="alert">{pageError}</div>}

          <section className="summary-section" aria-labelledby="teams-title">
            <div className="step-kicker">Kochreihenfolge</div>
            <h2 id="teams-title">{form.teams.length} Teams am Start</h2>
            <ol className="dinner-list">
              {orderedTeams.map((team) => (
                <li key={team.id ?? `${team.name}-${team.dinnerDate}`}>
                  <div className="dinner-date">{dateLabel(team.dinnerDate)}</div>
                  <strong>{team.name}</strong><span>Captain {team.captainName}</span>
                </li>
              ))}
            </ol>
          </section>

          {form.juryMembers.length > 0 && (
            <section className="summary-section" aria-labelledby="jury-title">
              <div className="step-kicker">Zusätzliche Stimmen</div>
              <h2 id="jury-title">{form.juryMembers.length} in der Jury</h2>
              <ul className="jury-summary">
                {form.juryMembers.map((member) => (
                  <li key={member.id ?? member.name}><span aria-hidden="true">★</span><strong>{member.name}</strong></li>
                ))}
              </ul>
            </section>
          )}

          <section className="summary-section" aria-labelledby="categories-title">
            <div className="step-kicker">Bewertung</div><h2 id="categories-title">Fünf Kategorien</h2>
            <ul className="category-summary">
              {form.categories.map((category, index) => (
                <li key={category.id ?? category.name}>
                  <span>{index + 1}</span><div><strong>{category.name}</strong><small>{category.question}</small></div>
                </li>
              ))}
            </ul>
          </section>

          <div className="summary-actions">
            {onDone && (
              <button className="button button--primary" type="button" onClick={onDone}>
                Zur Abendsteuerung
              </button>
            )}
            {!fullyLocked && (
              <button className="button button--secondary" type="button" onClick={() => {
                setStep(setupLocked ? 2 : 1); setShowSummary(false); setNotice("");
              }}>
                {setupLocked ? "Kommende Termine bearbeiten" : "Challenge bearbeiten"}
              </button>
            )}
          </div>
          {fullyLocked && <p className="locked-note">Die Challenge ist aufgelöst und bleibt unverändert erhalten.</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell shell--setup">
      <section className="setup-card" aria-labelledby="page-title">
        <header className="wizard-header">
          <button className="back-link" type="button" onClick={() =>
            step === 1 ? challenge && setShowSummary(true) : moveTo(step - 1)
          } disabled={step === 1 && !challenge}>← Zurück</button>
          <div className="eyebrow">Schritt {step} von 3</div>
        </header>
        <div className="progress" aria-label={`Schritt ${step} von 3`}><span style={{ width: `${(step / 3) * 100}%` }} /></div>
        {pageError && <div className="banner banner--error" role="alert">{pageError}</div>}

        {step === 1 && (
          <div className="form-step">
            <div className="plate-mark" aria-hidden="true">01</div>
            <h1 id="page-title">Wie heißt eure Challenge?</h1>
            <p className="lead">Ein kurzer Name reicht. Hauptsache, alle wissen, worum gekocht wird.</p>
            <label className="field" htmlFor="field-name"><span>Challenge-Name</span>
              <input id="field-name" value={form.name} onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value })); clearError("name");
              }} placeholder="z. B. Gargano Koch-Challenge" disabled={setupLocked}
                aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "error-name" : undefined} />
              {fieldErrors.name && <small className="field-error" id="error-name">{fieldErrors.name}</small>}
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="form-step">
            <div className="plate-mark" aria-hidden="true">02</div>
            <h1 id="page-title">Wer kocht wann?</h1>
            <p className="lead">Jedes Team bekommt genau einen Captain und einen Abend. Die Reihenfolge ergibt sich aus den Terminen.</p>
            {fieldErrors.teams && <div className="banner banner--error">{fieldErrors.teams}</div>}
            <div className="team-stack">
              {form.teams.map((team, index) => {
                const dateLocked = setupLocked && team.dinnerStatus !== "upcoming";
                return (
                  <fieldset className="team-block" key={team.id ?? index}><legend>Team {index + 1}</legend>
                    <label className="field" htmlFor={`field-teams-${index}-name`}><span>Teamname</span>
                      <input id={`field-teams-${index}-name`} value={team.name} onChange={(event) => updateTeam(index, "name", event.target.value)}
                        placeholder="z. B. Team Limone" disabled={setupLocked} aria-invalid={Boolean(fieldErrors[`teams.${index}.name`])} />
                      {fieldErrors[`teams.${index}.name`] && <small className="field-error">{fieldErrors[`teams.${index}.name`]}</small>}
                    </label>
                    <label className="field" htmlFor={`field-teams-${index}-captainName`}><span>Captain</span>
                      <input id={`field-teams-${index}-captainName`} value={team.captainName} onChange={(event) => updateTeam(index, "captainName", event.target.value)}
                        placeholder="Vorname oder Anzeigename" disabled={setupLocked} aria-invalid={Boolean(fieldErrors[`teams.${index}.captainName`])} />
                      {fieldErrors[`teams.${index}.captainName`] && <small className="field-error">{fieldErrors[`teams.${index}.captainName`]}</small>}
                    </label>
                    <label className="field" htmlFor={`field-teams-${index}-dinnerDate`}><span>Kochabend</span>
                      <input id={`field-teams-${index}-dinnerDate`} type="date" value={team.dinnerDate} onChange={(event) => updateTeam(index, "dinnerDate", event.target.value)}
                        disabled={dateLocked} aria-invalid={Boolean(fieldErrors[`teams.${index}.dinnerDate`])} />
                      {dateLocked && <small>Dieser Abend wurde bereits geöffnet und ist gesperrt.</small>}
                      {fieldErrors[`teams.${index}.dinnerDate`] && <small className="field-error">{fieldErrors[`teams.${index}.dinnerDate`]}</small>}
                    </label>
                    {!setupLocked && form.teams.length > 3 && (
                      <button type="button" className="text-button text-button--danger" onClick={() => setForm((current) => ({
                        ...current, teams: current.teams.filter((_, teamIndex) => teamIndex !== index),
                      }))}>Team entfernen</button>
                    )}
                  </fieldset>
                );
              })}
            </div>
            {!setupLocked && <button className="button button--secondary" type="button" onClick={() =>
              setForm((current) => ({ ...current, teams: [...current.teams, emptyTeam()] }))
            }>+ Team hinzufügen</button>}

            <section className="jury-editor" aria-labelledby="jury-editor-title">
              <div className="step-kicker">Optional</div>
              <h2 id="jury-editor-title">Zusätzliche Jury</h2>
              <p>Gäste in der Jury kochen nicht selbst und dürfen jeden Abend bewerten.</p>
              <div className="jury-stack">
                {form.juryMembers.map((member, index) => (
                  <fieldset className="jury-block" key={member.id ?? index}>
                    <legend>Jury {index + 1}</legend>
                    <label className="field" htmlFor={`field-juryMembers-${index}-name`}><span>Name</span>
                      <input
                        id={`field-juryMembers-${index}-name`}
                        value={member.name}
                        onChange={(event) => updateJuryMember(index, event.target.value)}
                        placeholder="Vorname oder Anzeigename"
                        disabled={setupLocked}
                        aria-invalid={Boolean(fieldErrors[`juryMembers.${index}.name`])}
                      />
                      {fieldErrors[`juryMembers.${index}.name`] && <small className="field-error">{fieldErrors[`juryMembers.${index}.name`]}</small>}
                    </label>
                    {!setupLocked && (
                      <button type="button" className="text-button text-button--danger" onClick={() => setForm((current) => ({
                        ...current,
                        juryMembers: current.juryMembers.filter((_, memberIndex) => memberIndex !== index),
                      }))}>Jury-Mitglied entfernen</button>
                    )}
                  </fieldset>
                ))}
              </div>
              {!setupLocked && <button className="button button--secondary" type="button" onClick={() =>
                setForm((current) => ({ ...current, juryMembers: [...current.juryMembers, { name: "" }] }))
              }>+ Jury-Mitglied hinzufügen</button>}
            </section>
          </div>
        )}

        {step === 3 && (
          <div className="form-step">
            <div className="plate-mark" aria-hidden="true">03</div>
            <h1 id="page-title">Was zählt am Tisch?</h1>
            <p className="lead">Die fünf Kategorien sind startklar. Du kannst sie vor dem ersten Voting anpassen.</p>
            <button className="category-toggle" type="button" aria-expanded={categoriesOpen} onClick={() => setCategoriesOpen((open) => !open)}>
              <span>{categoriesOpen ? "Kategorien einklappen" : "Kategorien anpassen"}</span><span aria-hidden="true">{categoriesOpen ? "−" : "+"}</span>
            </button>
            {!categoriesOpen && <ul className="category-preview">{form.categories.map((category, index) => <li key={category.id ?? index}>{category.name}</li>)}</ul>}
            {categoriesOpen && <div className="category-editor">{form.categories.map((category, index) => (
              <fieldset key={category.id ?? index} className="category-block"><legend>{index + 1}</legend>
                <label className="field" htmlFor={`field-categories-${index}-name`}><span>Kategorie</span>
                  <input id={`field-categories-${index}-name`} value={category.name} onChange={(event) => updateCategory(index, "name", event.target.value)}
                    disabled={setupLocked} aria-invalid={Boolean(fieldErrors[`categories.${index}.name`])} />
                  {fieldErrors[`categories.${index}.name`] && <small className="field-error">{fieldErrors[`categories.${index}.name`]}</small>}
                </label>
                <label className="field" htmlFor={`field-categories-${index}-question`}><span>Leitfrage</span>
                  <textarea id={`field-categories-${index}-question`} rows={2} value={category.question} onChange={(event) => updateCategory(index, "question", event.target.value)}
                    disabled={setupLocked} aria-invalid={Boolean(fieldErrors[`categories.${index}.question`])} />
                  {fieldErrors[`categories.${index}.question`] && <small className="field-error">{fieldErrors[`categories.${index}.question`]}</small>}
                </label>
              </fieldset>
            ))}</div>}
            <div className="review-box"><strong>Bereit zum Anrichten</strong><span>{form.teams.length} Teams · {form.juryMembers.length} Jury · {form.categories.length} Kategorien</span></div>
          </div>
        )}

        <footer className="wizard-actions">
          {step < 3 ? <button className="button button--primary" type="button" onClick={() => moveTo(step + 1)}>Weiter</button> :
            <button className="button button--primary" type="button" onClick={saveConfiguration} disabled={saving || fullyLocked}>
              {saving ? "Wird gespeichert …" : challenge ? "Änderungen speichern" : "Challenge speichern"}
            </button>}
        </footer>
      </section>
    </main>
  );
}
