import { Component, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest } from "../api";

interface AccessLink {
  voterId: string;
  role: "captain" | "jury";
  displayName: string;
  teamName: string | null;
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

class QrCodeBoundary extends Component<
  { resetKey: string; children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The dialog provides a local copy fallback; access tokens are never logged.
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function roleLabel(link: AccessLink): string {
  return link.role === "jury" ? "Jury" : (link.teamName ?? "Captain");
}

export function CaptainLinks() {
  const [links, setLinks] = useState<AccessLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [qrLink, setQrLink] = useState<AccessLink | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const qrTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ links: AccessLink[] }>("/api/admin/access-links", { signal: controller.signal })
      .then((payload) => setLinks(payload.links))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Die Links konnten nicht geladen werden.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!qrLink || !dialog) return;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
  }, [qrLink]);

  async function share(link: AccessLink) {
    setBusy(link.voterId);
    setError("");
    setNotice("");
    try {
      const shareAction = nativeShare();
      if (shareAction) {
        await shareAction({
          title: `Cucina Challenge – ${roleLabel(link)}`,
          text: `Hallo ${link.displayName}, hier ist dein persönlicher Link zur Koch-Challenge.`,
          url: link.link,
        });
        setNotice(`Link für ${link.displayName} geteilt.`);
      } else {
        await copyLink(link.link);
        setNotice(`Link für ${link.displayName} kopiert.`);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Der Link konnte nicht geteilt werden. Bitte versuche es erneut.");
    } finally {
      setBusy("");
    }
  }

  async function copyFromDialog(link: AccessLink) {
    try {
      await copyLink(link.link);
      setNotice(`Link für ${link.displayName} kopiert.`);
      dialogRef.current?.close();
    } catch {
      setError("Der Link konnte nicht kopiert werden. Bitte markiere ihn direkt aus der Linkliste.");
    }
  }

  function showQr(link: AccessLink, trigger: HTMLButtonElement) {
    qrTriggerRef.current = trigger;
    setError("");
    setQrLink(link);
  }

  function closedQrDialog() {
    setQrLink(null);
    qrTriggerRef.current?.focus();
  }

  return (
    <div className="page-content">
      <header className="hero-heading hero-heading--stacked">
        <div className="eyebrow">Persönliche Zugänge</div>
        <h1>Captain &amp; Jury</h1>
        <p>Jeder Link gehört genau zu einer Person. Am besten direkt teilen oder vor Ort scannen lassen.</p>
      </header>
      <div className="privacy-note"><span aria-hidden="true">◉</span><p><strong>Bitte privat teilen.</strong> Wer den Link hat, kann unter der angezeigten Identität abstimmen.</p></div>
      {notice && <div className="banner banner--success" role="status">✓ {notice}</div>}
      {error && <div className="banner banner--error" role="alert">{error}</div>}
      {loading ? <div className="loading loading--inline" role="status">Links werden vorbereitet …</div> : (
        <ul className="captain-links">
          {links.map((link, index) => (
            <li key={link.voterId}>
              <span className={`captain-links__number captain-links__number--${link.role}`} aria-hidden="true">{link.role === "jury" ? "★" : index + 1}</span>
              <span className="captain-links__identity"><strong>{link.displayName}</strong><small>{roleLabel(link)}</small></span>
              <span className="captain-links__actions">
                <button className="button button--small button--secondary" type="button" disabled={busy === link.voterId} onClick={() => void share(link)}>
                  {busy === link.voterId ? "…" : nativeShare() ? "Teilen" : "Kopieren"}
                </button>
                <button className="button button--small button--ghost" type="button" onClick={(event) => showQr(link, event.currentTarget)}>
                  QR-Code anzeigen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <dialog
        className="qr-dialog"
        ref={dialogRef}
        onClose={closedQrDialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        aria-labelledby="qr-dialog-title"
        aria-describedby="qr-dialog-description"
      >
        {qrLink && (
          <div className="qr-dialog__content">
            <button ref={closeButtonRef} className="icon-button qr-dialog__close" type="button" onClick={() => dialogRef.current?.close()} aria-label="QR-Code schließen">×</button>
            <div className="eyebrow">Persönlicher Zugang</div>
            <h2 id="qr-dialog-title">{qrLink.displayName}</h2>
            <p className="qr-dialog__role">{roleLabel(qrLink)}</p>
            <QrCodeBoundary
              resetKey={qrLink.link}
              fallback={
                <div className="qr-dialog__error" role="alert">
                  <p>Der QR-Code konnte nicht erzeugt werden. Du kannst den Link stattdessen kopieren.</p>
                  <button className="button button--secondary" type="button" onClick={() => void copyFromDialog(qrLink)}>Link kopieren</button>
                </div>
              }
            >
              <div className="qr-dialog__code" aria-label={`QR-Code für ${qrLink.displayName}`}>
                <QRCodeSVG
                  value={qrLink.link}
                  size={256}
                  level="M"
                  marginSize={2}
                  bgColor="#fffdf8"
                  fgColor="#26322c"
                  title={`Persönlicher Zugang für ${qrLink.displayName}`}
                />
              </div>
            </QrCodeBoundary>
            <p id="qr-dialog-description">Mit der Smartphone-Kamera scannen und den angezeigten Link öffnen.</p>
            <small>Vertraulich: Jede Person mit diesem Link stimmt als {qrLink.displayName} ab.</small>
          </div>
        )}
      </dialog>
    </div>
  );
}
