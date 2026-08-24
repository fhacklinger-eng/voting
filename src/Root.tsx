import { useEffect, useState } from "react";
import { AdminArea } from "./admin/AdminArea";
import { ApiRequestError, apiRequest, jsonRequest } from "./api";
import { Brand } from "./Brand";
import { CaptainArea } from "./captain/CaptainArea";

type AdminSession = { role: "admin" };
export type VoterSession = {
  role: "captain" | "jury";
  challengeId: string;
  challengeName: string;
  challengeStatus: "preparation" | "running" | "revealed";
  voterId: string;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
};
type Session = AdminSession | VoterSession;
type InitialSession = { session: Session | null; error: string };

interface AccessFragment {
  present: boolean;
  kind?: "admin" | "captain" | "jury";
  token?: string;
}

let accessFragmentRead = false;
let pendingAccess: AccessFragment | null = null;

function consumeAccessFragment(): AccessFragment {
  const hash = window.location.hash;
  if (!hash.startsWith("#/access/")) return { present: false };

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#/`,
  );
  const match = /^#\/access\/(admin|captain|jury)\/(.+)$/.exec(hash);
  if (!match) return { present: true };
  try {
    return {
      present: true,
      kind: match[1] as "admin" | "captain" | "jury",
      token: decodeURIComponent(match[2]),
    };
  } catch {
    return { present: true };
  }
}

async function clearSession(): Promise<void> {
  try {
    await apiRequest("/api/session/logout", { method: "POST" });
  } catch {
    // The neutral access screen is still the safest fallback if logout cannot be confirmed.
  }
}

function availabilityMessage(caught: unknown): string {
  if (
    caught instanceof ApiRequestError &&
    (caught.status === 0 || caught.status >= 500)
  ) {
    return caught.message;
  }
  return "";
}

async function loadInitialSession(): Promise<InitialSession> {
  if (!accessFragmentRead) {
    pendingAccess = consumeAccessFragment();
    accessFragmentRead = true;
  }
  const access = pendingAccess ?? { present: false };
  if (access.present) {
    if (!access.kind || !access.token) {
      pendingAccess = null;
      await clearSession();
      return { session: null, error: "" };
    }
    try {
      await apiRequest("/api/session/exchange", jsonRequest("POST", {
        kind: access.kind,
        token: access.token,
      }));
      pendingAccess = null;
    } catch (caught) {
      const error = availabilityMessage(caught);
      if (error) return { session: null, error };
      pendingAccess = null;
      await clearSession();
      return { session: null, error: "" };
    }
  } else {
    pendingAccess = null;
  }

  try {
    const payload = await apiRequest<{ session: Session }>("/api/session/me");
    return { session: payload.session, error: "" };
  } catch (caught) {
    return { session: null, error: availabilityMessage(caught) };
  }
}

let initialSessionRequest: Promise<InitialSession> | null = null;

export function Root() {
  const [initial, setInitial] = useState<InitialSession | undefined>(undefined);

  useEffect(() => {
    if (!initialSessionRequest) initialSessionRequest = loadInitialSession();
    initialSessionRequest.then(setInitial);
  }, []);

  async function logout() {
    await clearSession();
    setInitial({ session: null, error: "" });
  }

  function retry() {
    setInitial(undefined);
    initialSessionRequest = loadInitialSession();
    initialSessionRequest.then(setInitial);
  }

  if (initial === undefined) {
    return (
      <main className="shell shell--centered">
        <Brand />
        <div className="loading" role="status">Der Tisch wird gedeckt …</div>
      </main>
    );
  }

  if (initial.error) {
    return (
      <main className="shell shell--centered">
        <section className="access-card" aria-labelledby="access-error-title">
          <Brand />
          <div className="access-card__plate" aria-hidden="true"><span>!</span></div>
          <div className="eyebrow">Verbindung unterbrochen</div>
          <h1 id="access-error-title">Der Tisch ist gerade nicht erreichbar.</h1>
          <p>{initial.error}</p>
          <button className="button button--primary" type="button" onClick={retry}>Erneut versuchen</button>
        </section>
      </main>
    );
  }

  const session = initial.session;
  if (!session) {
    return (
      <main className="shell shell--centered">
        <section className="access-card" aria-labelledby="access-title">
          <Brand />
          <div className="access-card__plate" aria-hidden="true"><span>?</span></div>
          <div className="eyebrow">Persönlicher Zugang</div>
          <h1 id="access-title">Dieser Link ist nicht gültig.</h1>
          <p>Öffne bitte deinen persönlichen Link erneut oder frag eure Organisation nach einem neuen Link.</p>
        </section>
      </main>
    );
  }

  return session.role === "admin"
    ? <AdminArea onLogout={logout} />
    : <CaptainArea initialIdentity={session} onLogout={logout} />;
}
