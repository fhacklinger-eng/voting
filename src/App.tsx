import { useEffect, useState } from "react";

type HealthState = "loading" | "ready" | "unavailable";

export function App() {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Health check failed");
        setHealth("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setHealth("unavailable");
      });

    return () => controller.abort();
  }, []);

  const statusText = {
    loading: "Verbindung wird geprüft …",
    ready: "Technische Basis ist bereit",
    unavailable: "Datenbank ist noch nicht eingerichtet",
  }[health];

  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <div className="eyebrow">Koch-Challenge</div>
        <div className="plate" aria-hidden="true">🍋</div>
        <h1 id="page-title">Voting wird vorbereitet</h1>
        <p>
          Teams, Kochabende und die Abstimmung kommen als Nächstes. Die
          Cloudflare-Grundlage steht schon einmal auf dem Tisch.
        </p>
        <div className={`status status--${health}`} role="status">
          <span className="status__dot" aria-hidden="true" />
          {statusText}
        </div>
      </section>
    </main>
  );
}
