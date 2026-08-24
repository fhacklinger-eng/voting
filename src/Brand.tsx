export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? " brand--compact" : ""}`} aria-label="Cucina Challenge">
      <span className="brand__mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" role="img">
          <path d="M8 28a16 16 0 0 0 32 0H8Z" />
          <path d="M13 24h22" />
          <path d="M18 19c0-3 2-4 2-7M25 19c0-3 2-4 2-7M32 19c0-3 2-4 2-7" />
        </svg>
      </span>
      <span className="brand__type"><strong>Cucina</strong><small>Challenge</small></span>
    </div>
  );
}

export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${value}T12:00:00`));
}

