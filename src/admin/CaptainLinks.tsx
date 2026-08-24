import { useEffect, useState } from "react";
import { apiRequest } from "../api";

interface CaptainLink {
  teamName: string;
  captainName: string;
  link: string;
}

function fallbackCopy(value: string): boolean {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

async function copyLink(value: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (!fallbackCopy(value)) throw new Error("COPY_FAILED");
}

function nativeShare(): ((data: ShareData) => Promise<void>) | undefined {
  const share = (navigator as unknown as { share?: (data: ShareData) => Promise<void> }).share;
  return share?.bind(navigator);
}

export function CaptainLinks() {
  const [links, setLinks] = useState<CaptainLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ links: CaptainLink[] }>("/api/admin/captain-links", { signal: controller.signal })
      .then((payload) => setLinks(payload.links))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Die Links konnten nicht geladen werden.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function share(link: CaptainLink) {
    setBusy(link.teamName);
    setError("");
    setNotice("");
    try {
      const shareAction = nativeShare();
      if (shareAction) {
        await shareAction({
          title: `Cucina Challenge – ${link.teamName}`,
          text: `Hallo ${link.captainName}, hier ist dein persönlicher Link zur Koch-Challenge.`,
          url: link.link,
        });
        setNotice(`Link für ${link.captainName} geteilt.`);
      } else {
        await copyLink(link.link);
        setNotice(`Link für ${link.captainName} kopiert.`);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Der Link konnte nicht geteilt werden. Bitte versuche es erneut.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page-content">
      <header className="hero-heading hero-heading--stacked">
        <div className="eyebrow">Persönliche Zugänge</div>
        <h1>Captain-Links</h1>
        <p>Jeder Link gehört genau zu einem Team. Am besten direkt einzeln verschicken.</p>
      </header>
      <div className="privacy-note"><span aria-hidden="true">◉</span><p><strong>Bitte privat teilen.</strong> Wer den Link hat, kann für dieses Team abstimmen.</p></div>
      {notice && <div className="banner banner--success" role="status">✓ {notice}</div>}
      {error && <div className="banner banner--error" role="alert">{error}</div>}
      {loading ? <div className="loading loading--inline" role="status">Links werden vorbereitet …</div> : (
        <ul className="captain-links">
          {links.map((link, index) => (
            <li key={link.teamName}>
              <span className="captain-links__number" aria-hidden="true">{index + 1}</span>
              <span className="captain-links__identity"><strong>{link.captainName}</strong><small>{link.teamName}</small></span>
              <button className="button button--small button--secondary" type="button" disabled={busy === link.teamName} onClick={() => void share(link)}>
                {busy === link.teamName ? "…" : nativeShare() ? "Teilen" : "Kopieren"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
