# Entwicklung und Cloudflare-Betrieb

Diese Anleitung gilt für das MVP-Grundgerüst aus Issue #2, die
Challenge-Einrichtung aus Issue #3 sowie Zugang, Abendsteuerung und Captain-
Voting aus den Issues #4 bis #6.

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

Vor dem Start werden zwei lokale Secrets in einer Datei `.dev.vars` benötigt:

```dotenv
ADMIN_ACCESS_TOKEN=<mindestens-32-zufaellige-Zeichen>
AUTH_SIGNING_SECRET=<anderes-Secret-mit-mindestens-32-Zeichen>
```

Zwei geeignete Werte lassen sich auf macOS jeweils mit `openssl rand -hex 32`
erzeugen. `.dev.vars` ist in `.gitignore` eingetragen und darf nicht committed
werden. Die Werte müssen voneinander verschieden sein.

## Prüfen

```bash
npm test
npm run typecheck
npm run build
```

Die Tests laufen in der Cloudflare-Workers-Laufzeit mit einer isolierten
lokalen D1-Datenbank. Die Migrationen werden dabei automatisiert angewendet.

## Persönlichen Zugang öffnen

Der Admin öffnet lokal diese Adresse; `<ADMIN_ACCESS_TOKEN>` wird dabei durch
den Wert aus `.dev.vars` ersetzt:

```text
http://localhost:5173/#/access/admin/<ADMIN_ACCESS_TOKEN>
```

Die App tauscht den Fragment-Link einmalig gegen ein signiertes HttpOnly-Cookie
und entfernt das Token sofort aus der Adresszeile. Im Bereich `Captain-Links`
kann der Admin anschließend für jedes Team den persönlichen Link teilen oder
kopieren. Captain-Links dürfen nur privat an den jeweiligen Captain gehen.

Ein ungültiger, veränderter oder nicht zur Rolle passender Zugang zeigt keine
Challenge-Daten. Admin- und Captain-APIs sind serverseitig getrennt; die
Captain-Identität stammt ausschließlich aus der signierten Session und nicht
aus Formulardaten.

## Challenge einrichten und steuern

Beim ersten Aufruf führt die Oberfläche in drei Schritten durch Challenge-Name,
Teams mit Captains und Terminen sowie die fünf vorbelegten Kategorien. Die
Konfiguration wird über `GET/PUT /api/admin/challenge` vollständig und atomar
in D1 gespeichert.

Bis zum ersten geöffneten Kochabend können Challenge, Teams, Termine und
Kategorien geändert werden. Danach bleiben ausschließlich die Termine noch
bevorstehender Abende änderbar. Nach der Auflösung ist die Konfiguration nur
noch lesbar.

Unter `Abende` kann der Admin genau den chronologisch nächsten Abend öffnen.
Es kann höchstens einen offenen Abend geben. Beim Schließen werden fehlende
Captain-Stimmen namentlich angezeigt und müssen ausdrücklich bestätigt werden.
Ein geschlossener Abend kann wieder geöffnet werden; vorhandene Bewertungen
bleiben dabei erhalten. Punktwerte oder Zwischenergebnisse werden in der
Admin-Ansicht nicht angezeigt.

Captains sehen nur ihre eigene Identität, den Fortschritt und den aktuell
geöffneten fremden Kochabend. Eine Bewertung besteht immer vollständig aus den
fünf Kategorien mit jeweils 1 bis 5 Punkten. Sie kann solange überschrieben
werden, wie der Abend offen ist. Das eigene Team kann nicht bewertet werden.

## D1-Migrationen

Neue Migrationen werden als aufsteigend nummerierte SQL-Dateien in
`migrations/` abgelegt. Bereits veröffentlichte Migrationen werden nicht
nachträglich geändert.

Die Issues #4 bis #6 verwenden das bereits mit `0001_initial.sql` angelegte
Schema und benötigen keine neue Migration.

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
5. Zwei voneinander verschiedene Zufallswerte mit jeweils mindestens 32 Zeichen
   erzeugen und als Cloudflare-Secrets setzen:

   ```bash
   npx wrangler secret put ADMIN_ACCESS_TOKEN
   npx wrangler secret put AUTH_SIGNING_SECRET
   ```

   Wrangler fragt jeden Wert verdeckt ab. Secrets niemals in
   `wrangler.jsonc`, GitHub-Issues oder Logs eintragen.
6. Build und Tests ausführen: `npm test && npm run build`.
7. Auf die `workers.dev`-Adresse deployen: `npm run deploy`.
8. `GET /api/health` aufrufen. Erwartet werden HTTP 200 und `database: ready`.
9. Den Admin-Link mit dem produktiven Secret öffnen:
   `https://<worker>.workers.dev/#/access/admin/<ADMIN_ACCESS_TOKEN>`.

Wenn die D1-Datenbank bereits angelegt und ihre ID in `wrangler.jsonc`
eingetragen ist, wird sie nicht erneut erstellt. Für die Issues #4 bis #6 sind
dann nur die beiden Secrets neu bereitzustellen.

## Manuelle Abnahme #4 bis #6

1. Admin-Link öffnen: Die Adresse enthält danach kein Token mehr und die
   Abendsteuerung wird angezeigt.
2. Einen Captain-Link privat öffnen: Captain, Team und Challenge stimmen; Admin-
   Funktionen sind nicht sichtbar.
3. Einen Captain-Link verändern: Es erscheint nur die neutrale Zugangsseite.
4. Ersten Abend öffnen: Die Challenge wechselt auf `läuft`; ein zweiter Abend
   lässt sich nicht gleichzeitig öffnen.
5. Kochendes Team öffnen: Es gibt keine Bewertungsaktion für das eigene Essen.
6. Fremder Captain bewertet nicht alle Kategorien: Speichern wird verhindert
   und die fehlenden Kategorien werden markiert.
7. Alle fünf Werte speichern und erneut öffnen: Die Auswahl ist vorhanden und
   kann geändert werden; Admin sieht nur `abgegeben`, keine Punkte.
8. Abend mit fehlenden Stimmen schließen: Namen werden genannt und es ist eine
   ausdrückliche zweite Bestätigung nötig.
9. Während eines offenen Stimmzettels den Abend anderweitig schließen und dann
   speichern: Die Auswahl bleibt sichtbar; die App meldet, dass nichts
   gespeichert wurde.
10. Abend wieder öffnen: Bereits gespeicherte Bewertungen sind weiterhin da.

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
