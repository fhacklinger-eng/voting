import { useEffect, useState } from "react";
import { AdminArea } from "./admin/AdminArea";
import { apiRequest, jsonRequest } from "./api";
import { Brand } from "./Brand";
import { CaptainArea } from "./captain/CaptainArea";

type AdminSession = { role: "admin" };
export type CaptainSession = {
  role: "captain";
  challengeId: string;
  challengeName: string;
  challengeStatus: "preparation" | "running" | "revealed";
  teamId: string;
  teamName: string;
  captainName: string;
};
type Session = AdminSession | CaptainSession;

interface AccessFragment {
  present: boolean;
  kind?: "admin" | "captain";
  token?: string;
}

function consumeAccessFragment(): AccessFragment {
  const hash = window.location.hash;
  if (!hash.startsWith("#/access/")) return { present: false };

  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#/`,
  );
  const match = /^#\/access\/(admin|captain)\/(.+)$/.exec(hash);
  if (!match) return { present: true };
  try {
    return {
      present: true,
      kind: match[1] as "admin" | "captain",
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

async function loadInitialSession(): Promise<Session | null> {
  const access = consumeAccessFragment();
  if (access.present) {
    if (!access.kind || !access.token) {
      await clearSession();
      return null;
    }
    try {
      await apiRequest("/api/session/exchange", jsonRequest("POST", {
        kind: access.kind,
        token: access.token,
      }));
    } catch {
      await clearSession();
      return null;
    }
  }

  try {
    const payload = await apiRequest<{ session: Session }>("/api/session/me");
    return payload.session;
  } catch {
    return null;
  }
}

let initialSessionRequest: Promise<Session | null> | null = null;

export function Root() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!initialSessionRequest) initialSessionRequest = loadInitialSession();
    initialSessionRequest.then(setSession);
  }, []);

  async function logout() {
    await clearSession();
    setSession(null);
  }

  if (session === undefined) {
    return (
      <main className="shell shell--centered">
        <Brand />
        <div className="loading" role="status">Der Tisch wird gedeckt …</div>
      </main>
    );
  }

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

