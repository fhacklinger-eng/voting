# Entwicklung und Cloudflare-Betrieb

Diese Anleitung gilt für das MVP-Grundgerüst aus Issue #2 und die
Challenge-Einrichtung aus Issue #3. Produkt- und UI-Konzept befinden sich im
übergeordneten README und unter `docs/`.

## Voraussetzungen

- Node.js 22 oder neuer
- npm
- erst für ein Cloudflare-Deployment: ein Cloudflare-Account mit Workers und D1

## Lokal starten

```bash
npm ci
npm run db:migrate:local
npm run dev
```

Die Anwendung ist danach standardmäßig unter `http://localhost:5173` erreichbar.
Die lokale D1-Datenbank liegt ausschließlich im lokalen Wrangler-Zustand und
hat keinen Zugriff auf gehostete Daten.

## Prüfen

```bash
npm test
npm run typecheck
npm run build
```

Die Tests laufen in der Cloudflare-Workers-Laufzeit mit einer isolierten
lokalen D1-Datenbank. Die Migrationen werden dabei automatisiert angewendet.

## Challenge einrichten

Beim ersten Aufruf führt die Oberfläche in drei Schritten durch Challenge-Name,
Teams mit Captains und Terminen sowie die fünf vorbelegten Kategorien. Die
Konfiguration wird über `GET/PUT /api/admin/challenge` vollständig und atomar
in D1 gespeichert.

Bis zum ersten geöffneten Kochabend können Challenge, Teams, Termine und
Kategorien geändert werden. Danach bleiben ausschließlich die Termine noch
bevorstehender Abende änderbar. Nach der Auflösung ist die Konfiguration nur
noch lesbar. Die Zugangskontrolle für die Admin-API wird mit Issue #4 ergänzt;
bis dahin darf dieser Branch nur in der privaten Entwicklungsumgebung verwendet
werden.

## D1-Migrationen

Neue Migrationen werden als aufsteigend nummerierte SQL-Dateien in
`migrations/` abgelegt. Bereits veröffentlichte Migrationen werden nicht
nachträglich geändert.

Lokal anwenden:

```bash
npm run db:migrate:local
```

Auf die gehostete Datenbank anwenden:

```bash
npm run db:migrate:remote
```

Der Remote-Befehl darf erst verwendet werden, nachdem die echte D1-Datenbank
angelegt und ihre ID in `wrangler.jsonc` eingetragen wurde.

## Erstes Cloudflare-Deployment

Für die Implementierung und lokale Prüfung ist noch keine Cloudflare-Einrichtung
notwendig. Vor dem ersten Deployment sind einmalig folgende Schritte nötig:

1. Bei Cloudflare authentifizieren: `npx wrangler login`.
2. EU-Datenbank erstellen:
   `npx wrangler d1 create voting --jurisdiction=eu`.
3. Die ausgegebene `database_id` anstelle der Null-ID in `wrangler.jsonc`
   eintragen. Die ID ist kein Secret; Zugangstoken werden dort nie eingetragen.
4. Migrationen anwenden: `npm run db:migrate:remote`.
5. Build und Tests ausführen: `npm test && npm run build`.
6. Auf die `workers.dev`-Adresse deployen: `npm run deploy`.
7. `GET /api/health` aufrufen. Erwartet werden HTTP 200 und `database: ready`.

Die Secrets `ADMIN_ACCESS_TOKEN` und `AUTH_SIGNING_SECRET` werden erst mit dem
Zugangs-Issue #4 benötigt. Sie dürfen später ausschließlich über Cloudflare
Secrets gesetzt werden, nicht in `wrangler.jsonc` oder `.dev.vars` im Repository.

## Wechsel zu `voting.kivio.uk`

Nach erfolgreicher Abnahme auf `workers.dev`:

1. Testdaten vor dem echten Einsatz kontrolliert zurücksetzen.
2. Migrationen und Health-Check erneut prüfen.
3. `voting.kivio.uk` als Custom Domain an denselben Worker binden.
4. Optional `workers_dev` deaktivieren und erneut deployen, damit nur noch die
   eigene Domain verwendet wird.

Es werden kein zweiter Worker und keine zweite gehostete D1-Datenbank angelegt.

## Fehler und Wiederherstellung

Schlägt eine Migration fehl, wird nicht weiter deployt. Die Ursache wird lokal
korrigiert und als neue Vorwärtsmigration bereitgestellt. Es gibt im MVP keinen
eigenen Backup-Job. Falls bei gehosteten Daten eine Wiederherstellung nötig ist,
kann Cloudflare D1 Time Travel manuell verwendet werden.
