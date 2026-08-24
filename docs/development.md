# Entwicklung und Cloudflare-Betrieb

Diese Anleitung gilt für das MVP-Grundgerüst aus Issue #2, die
Challenge-Einrichtung aus Issue #3 sowie Zugang, Abendsteuerung und Captain-
Voting aus den Issues #4 bis #6, die gemeinsame Ergebnisauflösung aus Issue #7
sowie QR-Zugänge, Jury und die neue Standardkategorie aus #11 bis #13.

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
und entfernt das Token sofort aus der Adresszeile. Im Bereich `Zugänge` kann
der Admin anschließend jeden Captain- und Jury-Link teilen, kopieren oder als
QR-Code anzeigen. Der QR-Code wird lokal im Browser erzeugt; der Link wird
nicht an einen externen Dienst gesendet. Persönliche Links dürfen nur privat an
die jeweils angezeigte Person gehen.

Ein ungültiger, veränderter oder nicht zur Rolle passender Zugang zeigt keine
Challenge-Daten. Admin- und Wähler-APIs sind serverseitig getrennt; Rolle und
Identität stammen ausschließlich aus der signierten Session und nicht aus
Formulardaten.

## Challenge einrichten und steuern

Beim ersten Aufruf führt die Oberfläche in drei Schritten durch Challenge-Name,
Teams mit Captains und Terminen, eine optionale Jury sowie die fünf vorbelegten
Kategorien. Die fünfte Standardkategorie heißt `Gesamterlebnis` mit der Frage
„Wie stimmig war der Abend insgesamt?“. Die Konfiguration wird über
`GET/PUT /api/admin/challenge` vollständig und atomar in D1 gespeichert.

Bis zum ersten geöffneten Kochabend können Challenge, Teams, Jury, Termine und
Kategorien geändert werden. Jury-Namen sind innerhalb der Jury unabhängig von
Groß-/Kleinschreibung eindeutig. Danach bleiben ausschließlich die Termine
noch bevorstehender Abende änderbar. Nach der Auflösung ist die Konfiguration
nur noch lesbar.

Unter `Abende` kann der Admin genau den chronologisch nächsten Abend öffnen.
Es kann höchstens einen offenen Abend geben. Beim Schließen werden fehlende
Stimmen mit Name und Rolle angezeigt und müssen ausdrücklich bestätigt werden.
Ein geschlossener Abend kann wieder geöffnet werden; vorhandene Bewertungen
bleiben dabei erhalten. Punktwerte oder Zwischenergebnisse werden in der
Admin-Ansicht nicht angezeigt.

Captains und Jury-Mitglieder sehen nur ihre eigene Identität, ihren Fortschritt
und die Kochabende. Eine Bewertung besteht immer vollständig aus den fünf
Kategorien mit jeweils 1 bis 5 Punkten. Sie kann solange überschrieben werden,
wie der Abend offen ist. Captains können das eigene Team nicht bewerten;
Jury-Mitglieder dürfen jeden Abend bewerten. Beide Rollen zählen gleich stark.

## Ergebnis auflösen

Die Admin-Ansicht bietet `Ergebnis auflösen` erst an, wenn alle Kochabende
geschlossen sind und jedes Team mindestens eine vollständige Fremdbewertung
erhalten hat. Fehlen einzelne der erwarteten Stimmen, nennt eine letzte
Bestätigung Person, Rolle und betroffenen Abend. Nach der Bestätigung ist die
Auflösung dauerhaft und sämtliche Konfigurationen, Abendzustände und
Bewertungen bleiben gesperrt.

Admin, Captains und Jury sehen danach über ihre bestehenden Zugänge dieselben
anonymisierten Ergebnisse. Zunächst werden die fünf Kategoriesieger gezeigt;
`Gesamtsieger enthüllen` öffnet die vollständige Gesamtrangliste. Einzelstimmen
und ihre Zuordnung zu Personen werden auch nach der Auflösung nie ausgegeben.
Beim erneuten Laden beginnt die Darstellung wieder mit den Kategorien, ohne den
gespeicherten Challenge-Zustand zu verändern.

Fehlende Bewertungen fließen nicht als Nullwert ein. Kategorie- und
Gesamtscores werden aus den vorhandenen vollständigen Bewertungen berechnet,
kaufmännisch auf zwei Nachkommastellen gerundet und mit dichter Rangfolge
dargestellt (`1, 1, 2`). Bei unvollständiger Teilnahme wird die Zahl der
berücksichtigten Bewertungen neben dem jeweiligen Team angezeigt.

## D1-Migrationen

Neue Migrationen werden als aufsteigend nummerierte SQL-Dateien in
`migrations/` abgelegt. Bereits veröffentlichte Migrationen werden nicht
nachträglich geändert.

`0002_voters_and_category.sql` führt das gemeinsame Wählermodell für Captains
und Jury ein. Bestehende Captain-IDs, Links, Ballots und Ratings bleiben dabei
erhalten. Nur eine noch exakt unveränderte Kategorie `Urlaubslegende` mit der
alten Leitfrage wird in `Gesamterlebnis` umbenannt; individuelle Anpassungen
bleiben unangetastet.

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

## Challenge-Daten zurücksetzen

Für einen Neustart der Challenge kann die gehostete D1-Datenbank geleert
werden, ohne Tabellen, angewendete Migrationen oder Secrets zu entfernen:

```bash
npm run db:reset:remote
```

Das Script nennt das Ziel ausdrücklich und verlangt vor der Löschung die exakte
Eingabe `RESET voting`. Anschließend müssen die ausgegebenen Zähler für
Challenges, Teams, Abende, Stimmzettel, Bewertungen und Kategorien alle `0`
sein. Das Script darf erneut ausgeführt werden; eine bereits leere Datenbank
bleibt leer. Es funktioniert sowohl vor als auch nach der Jury-Migration.

Für die lokale Wrangler-Datenbank gibt es entsprechend:

```bash
npm run db:reset:local
```

Wichtig: Der Remote-Reset löscht sämtliche Challenge- und Bewertungsdaten
unwiderruflich. Er wird nicht automatisch beim Deployment ausgeführt.

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
eingetragen ist, wird sie nicht erneut erstellt. Für #11 bis #13 werden weder
neue Secrets noch weitere Cloudflare-Ressourcen benötigt. Vor dem Deployment
muss jedoch die neue D1-Migration mit `npm run db:migrate:remote` angewendet
werden.

## Manuelle Abnahme #11 bis #13

1. In der Vorbereitung zwei Jury-Mitglieder anlegen, eines umbenennen und
   eines entfernen. Ein Jury-Name, der sich nur durch Groß-/Kleinschreibung von
   einem anderen unterscheidet, wird abgelehnt.
2. Den ersten Abend öffnen. Jury sowie Teams und Kategorien sind danach
   gesperrt; nur zulässige künftige Termine bleiben editierbar.
3. Unter `Zugänge` für einen Captain und ein Jury-Mitglied jeweils `QR-Code`
   öffnen. Name, Rolle beziehungsweise Team und Vertraulichkeitshinweis stimmen;
   ein Smartphone öffnet beim Scan exakt den zugehörigen persönlichen Link.
4. QR-Dialog mit Schließen-Schaltfläche, Klick auf die Fläche außerhalb und
   Escape schließen. Danach liegt der Tastaturfokus wieder auf dem zuvor
   verwendeten QR-Auslöser. Die Ansicht bleibt bei 320 px Breite bedienbar.
5. Jury-Link öffnen: Die Rolle `Jury` ist sichtbar, alle Kochabende zählen zum
   Fortschritt und jeder offene Abend kann bewertet und bis zum Schließen
   geändert werden. Admin-Funktionen bleiben unsichtbar und serverseitig
   gesperrt.
6. Admin-Status prüfen: Für jeden Abend werden Captains und Jury getrennt mit
   `abgegeben` oder `offen` angezeigt; die erwartete Stimmenzahl ist
   `Anzahl Teams - 1 + Anzahl Jury`.
7. Challenge auflösen: Captain- und Jury-Bewertungen fließen gleichgewichtet
   ein, fehlende Bewertungen werden nicht als Null gewertet, und Jury sowie
   Captains sehen identische anonymisierte Ergebnisse.
8. Bestehende produktive Challenge vor und nach Migration stichprobenartig
   vergleichen: Captain-Links funktionieren weiter, frühere Bewertungen sind
   vorhanden, IDs und Reihenfolge der fünften Kategorie bleiben erhalten.
   Eine unveränderte alte Standardkategorie heißt danach `Gesamterlebnis`;
   eine individuell bearbeitete Variante bleibt unverändert.

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

## Manuelle Abnahme #7

1. Solange mindestens ein Abend offen oder bevorstehend ist, bleibt die
   Auflösung gesperrt.
2. Alle Abende schließen, aber ein Team ohne einzige Fremdbewertung lassen: Die
   Admin-Ansicht benennt das Team und bietet keine Auflösung an.
3. Jedem Team mindestens eine Bewertung geben, aber einzelne erwartete Stimmen
   auslassen: `Ergebnis auflösen` zeigt vor der endgültigen Aktion Captain und
   betroffenen Abend sowie den Hinweis, dass Nachmeldungen unmöglich sind.
4. Endgültig auflösen: Zuerst erscheinen ausschließlich die fünf
   Kategoriesieger. Gleichstände zeigen mehrere Sieger.
5. `Gesamtsieger enthüllen` wählen: Alle Teams erscheinen mit dicht gezählten
   Plätzen und Scores mit zwei Nachkommastellen.
6. Dieselbe Challenge mit einem Captain-Link öffnen: Werte und Platzierungen
   stimmen mit der Admin-Ansicht überein; Einzelstimmen bleiben unsichtbar.
7. Seite neu laden: Die Challenge bleibt aufgelöst, beginnt visuell wieder bei
   den Kategorien und erlaubt keine Änderung an Setup, Abenden oder Stimmen.

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
