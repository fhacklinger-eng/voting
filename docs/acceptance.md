# MVP-Abnahme und Browser-Matrix

Diese Checkliste ist das manuelle Gegenstück zu `npm run verify`. Sie wird auf
der Cloudflare-Testadresse durchgeführt, bevor die Challenge auf
`voting.kivio.uk` umgestellt wird. Es werden keine zusätzlichen Dienste,
Tracker, Hintergrundjobs oder Backup-Komponenten benötigt.

## 1. Automatisierte Abdeckung

| Kritische Regel | Automatisierter Nachweis |
|---|---|
| Rollen, geheime Tokens, manipulierter Link und Same-Origin-Schutz | `test/auth.test.ts` |
| Migrationen erzeugen das vollständige D1-Modell | `test/domain-model.test.ts` |
| höchstens ein offener Abend, auch bei konkurrierenden Aktionen | `test/domain-model.test.ts`, `test/voting-flow.test.ts` |
| keine Selbstbewertung und keine Bewertung außerhalb des offenen Zustands | `test/voting-flow.test.ts`, `test/mvp-journey.test.ts` |
| genau ein vollständiger, atomar gespeicherter Stimmzettel je Berechtigtem und Abend | `test/domain-model.test.ts`, `test/voting-flow.test.ts` |
| keine fremden Scores oder Ergebnisse vor der Auflösung | `test/results.test.ts`, `test/mvp-journey.test.ts` |
| Rundung, Gleichstände und dichte Platzierung | `test/results.test.ts`, `test/mvp-journey.test.ts` |
| unveränderliche Challenge nach der Auflösung | `test/challenge-setup.test.ts`, `test/results.test.ts`, `test/mvp-journey.test.ts` |
| keine Teildaten bei fehlgeschlagenem Schreiben | `test/challenge-setup.test.ts`, `test/domain-model.test.ts` |
| unerwartete Serverfehler enthalten weder Interna noch Secrets | `test/worker.test.ts` |
| vollständiger Weg vom leeren System bis zur Ergebnisanzeige | `test/mvp-journey.test.ts` |

Erwartetes Ergebnis von `npm run verify`: Typprüfung erfolgreich, alle Tests
grün und Produktions-Build erfolgreich. Die Tests verwenden feste Testsecrets;
Produktionssecrets werden weder benötigt noch gelesen.

## 2. Voraussetzungen für die manuelle Abnahme

- Das Deployment und der Health-Check aus `docs/development.md` sind
  erfolgreich.
- Die verwendete D1-Datenbank ist leer oder enthält ausdrücklich entbehrliche
  Testdaten. `npm run db:reset:remote` ist destruktiv und darf nur nach Prüfung
  des angezeigten Ziels verwendet werden.
- Ein aktuelles iPhone mit Mobile Safari, ein aktuelles Gerät mit Chrome und ein
  Desktop-Browser stehen bereit.
- Für den Test werden drei Teams, drei Captains und optional ein Jury-Mitglied
  verwendet. Die Kochtermine liegen in eindeutiger Reihenfolge.

## 3. Durchgängiger Abnahmelauf

1. Den Admin-Link öffnen und eine Challenge mit mindestens drei Teams speichern.
   Erwartung: Die Zusammenfassung zeigt alle Teams, Captains, Termine und fünf
   Kategorien; nach dem Speichern führt der Ablauf zu den persönlichen Zugängen.
2. Je einen Captain- und Jury-Link teilen beziehungsweise per QR-Code öffnen.
   Erwartung: Das Token verschwindet aus der Adresszeile, Name und Rolle stimmen,
   und Admin-Funktionen sind für Stimmberechtigte nicht erreichbar.
3. Den ersten Abend öffnen. Mit den fremden Captain-Links und dem Jury-Link alle
   fünf Werte setzen, speichern, erneut öffnen und einen Wert ändern.
   Erwartung: Das eigene Team kann nicht abstimmen; pro Person existiert genau
   eine änderbare Bewertung und die Orga sieht nur den Abgabestatus.
4. Den Abend schließen und die beiden folgenden Abende in derselben Weise
   durchführen. Erwartung: Nie sind zwei Abende gleichzeitig offen; vorhandene
   Bewertungen bleiben nach Wiederöffnen erhalten.
5. Alle Abende schließen und das Ergebnis auflösen. Erwartung: Zuerst erscheinen
   die Kategoriesieger, danach die Gesamtrangliste. Gleichstände teilen sich den
   Platz; Orga, Captains und Jury sehen identische anonymisierte Ergebnisse.
6. Nach der Auflösung Setup, Abendsteuerung und einen alten Stimmzettel erneut
   aufrufen. Erwartung: Alle schreibenden Aktionen bleiben gesperrt; ein Reload
   verändert weder Ergebnisse noch Daten.

## 4. Fehler- und Konsistenzprüfung

- **Ungültiger Link:** Ein Zeichen im Token ändern. Es erscheint nur die
  neutrale Zugangsseite, ohne Challenge-, Team- oder Personendaten.
- **Validierung:** Eine Kategorie im Stimmzettel auslassen und absenden. Erst
  jetzt werden die fehlenden Kategorien markiert; der Fokus springt zur ersten
  Lücke. Bereits gesetzte Werte bleiben erhalten.
- **Geänderter Zustand:** Einen geöffneten Stimmzettel in Browser A stehen
  lassen, den Abend in der Orga-Ansicht schließen und anschließend in Browser A
  speichern. Die App erklärt den Konflikt; die sichtbare Auswahl bleibt stehen
  und es entstehen keine Teildaten.
- **Verbindungsfehler:** In den Browser-Entwicklertools `Offline` aktivieren und
  eine Bewertung speichern. Die Meldung fordert zur Netzprüfung und zum erneuten
  Versuch auf; technische Fehlertexte und Secrets bleiben unsichtbar. Nach dem
  Wiederherstellen der Verbindung lässt sich dieselbe Auswahl speichern.
- **Initialer Serverfehler:** Die Anwendung bei unterbrochener Verbindung neu
  laden. Sie unterscheidet die Nichterreichbarkeit von einem ungültigen Link und
  bietet `Erneut versuchen` an.

## 5. Browser, Responsive und Bedienbarkeit

| Ansicht | Mobile Safari | Chrome mobil | Desktop-Browser |
|---|---:|---:|---:|
| persönlicher Zugang und Captain-Übersicht | Pflicht | Pflicht | Stichprobe |
| Bewertung inklusive Bearbeiten und Fehler | Pflicht | Pflicht | Tastaturprüfung |
| Orga-Einrichtung und Abendsteuerung | Stichprobe | Pflicht | Pflicht |
| Kategorie- und Gesamtergebnis | Pflicht | Pflicht | Pflicht |

Zusätzlich prüfen:

- bei 320 CSS-Pixeln kein horizontales Scrollen und keine überdeckten Inhalte;
- alle fünf Bewertungswerte bleiben in einer Reihe und mindestens 44 × 44 Pixel;
- bei 200 % Textvergrößerung bleiben Namen, Rollen und Aktionen lesbar;
- sichtbare Fokusmarkierungen bei Tab-, Space- und Pfeiltastenbedienung;
- Auswahl, Rollen, Status und Fehler sind nicht nur durch Farbe erkennbar;
- die Sticky-Aktionsleiste berücksichtigt die iOS-Safe-Area und verdeckt den
  letzten Bewertungsblock nicht.

Die zentralen Farbkombinationen liegen rechnerisch mindestens bei einem
Kontrastverhältnis von 4,58:1; die tatsächliche Darstellung wird trotzdem in
den oben genannten Browsern geprüft.

## 6. Netzwerk- und Datenschutzprüfung

Vor der Auflösung im Netzwerk-Panel kontrollieren:

- `/api/admin/dashboard` und `/api/voter/dashboard` enthalten weder `score`
  noch `ratings`;
- `/api/admin/results` und `/api/voter/results` liefern noch keine Ergebnisse;
- ein Stimmzettel liefert nur die eigene Auswahl zum Bearbeiten, niemals Stimmen
  anderer Personen;
- es gehen keine Requests an externe Analyse-, QR-, Schrift- oder Bilddienste;
- Session-Cookies sind `HttpOnly`, `Secure` und `SameSite=Strict`;
- geheime Tokens erscheinen nach dem Austausch weder in der URL noch in
  Antworten oder Logs.

## 7. Abnahmeprotokoll

| Prüfung | Browser/Gerät und Version | Datum | Ergebnis/Abweichung |
|---|---|---|---|
| Mobile Safari |  |  |  |
| Chrome mobil |  |  |  |
| Desktop |  |  |  |
| 320 px und 200 % Text |  |  |  |
| Fehler- und Konfliktfälle |  |  |  |
| Netzwerkantworten |  |  |  |

Abweichungen werden als eigenes Issue dokumentiert. Erst wenn `npm run verify`
und alle Pflichtzeilen dieses Protokolls erfolgreich sind, ist #8 vollständig
abgenommen.
