# Voting – Produktkonzept

Status: Produktidee für ein leichtgewichtiges MVP  
Zielumgebung: Web-Anwendung auf Cloudflare  
Primärer Einsatzfall: private Koch-Challenge im Urlaub

## Dokumentation

- [Softwarearchitektur](docs/architecture.md)
- [UI-Konzept](docs/ui-concept.md)
- [Grafischer UI-Entwurf](docs/ui-concept.svg)
- [Entwicklung und Cloudflare-Betrieb](docs/development.md)

## 1. Produktidee in einem Satz

Voting begleitet eine private Koch-Challenge: Nach jedem Kochabend bewerten die Captains der anderen Teams und optional eine zusätzliche Jury das Essen in wenigen, passenden Kategorien; bis zur gemeinsamen Siegerehrung bleiben alle Ergebnisse verborgen.

## 2. Ausgangslage und Nutzerproblem

Im Urlaub treten zufällig zusammengestellte Teams gegeneinander an. Jedes Team kocht an einem Abend für die gesamte Gruppe. Am Ende soll nachvollziehbar, fair und mit etwas Augenzwinkern feststehen, welches Team den besten Abend gestaltet hat.

Eine Abstimmung per Chat, Zettel oder Tabellenblatt wäre zwar möglich, hat aber Nachteile:

- Bewertungen sind für andere sichtbar und können spätere Stimmen beeinflussen.
- Ergebnisse müssen manuell zusammengeführt und berechnet werden.
- Es ist leicht unklar, wer bereits abgestimmt hat.
- Eine spätere gemeinsame Auflösung verliert an Spannung.

Die Anwendung soll diese Reibung beseitigen, ohne aus dem Urlaub ein Verwaltungsprojekt zu machen.

## 3. Produktziel

Die Anwendung ermöglicht allen Stimmberechtigten, einen Kochabend direkt und in weniger als einer Minute zu bewerten. Sie sorgt für eine einheitliche Bewertung, hält Zwischenergebnisse geheim und inszeniert am Ende eine einfache, unterhaltsame Siegerehrung.

Das Produkt ist erfolgreich, wenn:

- Captains und optionale Jury-Mitglieder ohne Erklärung oder Benutzerkonto abstimmen können;
- eine vollständige Bewertung auf dem Smartphone höchstens etwa eine Minute dauert;
- niemand vor der Auflösung Zwischenergebnisse oder Einzelstimmen sieht;
- der Organisator jederzeit erkennt, welche Stimmberechtigten bereits abgestimmt haben;
- das Gesamtergebnis ohne manuelle Nacharbeit präsentiert werden kann.

## 4. Empfohlene Abstimmungslogik

### Entscheidung: Bewertung nach jedem Kochabend

Jeder Kochabend wird bewertet, solange Geschmack, Stimmung und kleine Küchenkatastrophen noch frisch in Erinnerung sind. Da zwischen den Abenden jeweils ein freier Tag liegt, bleibt genügend Zeit zur Abstimmung.

Alternativen wurden bewusst verworfen:

| Variante | Vorteil | Nachteil | Entscheidung |
|---|---|---|---|
| Bewertung nach jedem Abend | frische Erinnerung, kurze Aufgabe, gleiche Situation für alle | mehrere kleine Abstimmungen | empfohlen |
| Einmalige Abstimmung am Urlaubsende | nur ein Abstimmungszeitpunkt | Erinnerung verzerrt, letzter Abend wird bevorzugt, längerer Fragebogen | nicht verwenden |
| Laufende öffentliche Rangliste | hoher Unterhaltungswert | beeinflusst spätere Stimmen und fördert taktisches Bewerten | nicht verwenden |

### Regeln

- Pro Team gibt es genau einen Captain.
- Ein Captain bewertet jeden Kochabend außer dem Abend des eigenen Teams.
- Optional eingerichtete Jury-Mitglieder gehören zu keinem Team und bewerten jeden Kochabend.
- Captain- und Jury-Stimmen zählen gleich stark.
- Bewertet wird je Kategorie auf einer Skala von 1 bis 5.
- Alle Kategorien müssen beantwortet werden, bevor die Bewertung abgeschickt werden kann.
- Eine abgegebene Bewertung kann bis zum Schließen des jeweiligen Kochabends geändert werden.
- Der Organisator sieht nur, wer bereits abgestimmt hat, nicht die einzelnen vergebenen Punkte.
- Zwischenergebnisse bleiben für alle verborgen, bis der Organisator die Challenge auflöst.
- Alle Kategorien zählen gleich stark; es gibt keine Gewichtung.
- Fehlende Stimmen werden nicht künstlich ersetzt. Vor der Auflösung zeigt das System deutlich, welche Stimmen fehlen.
- Bei Punktgleichheit gibt es einen geteilten Sieg. Ein komplizierter Tie-Breaker passt nicht zum Anlass.

### Berechnung

Für jedes Team wird je Kategorie der Durchschnitt aller gültigen Bewertungen berechnet. Der Gesamtscore ist der Durchschnitt der Kategorie-Scores.

Zusätzlich zum Gesamtsieger werden die Sieger der einzelnen Kategorien angezeigt. Werte werden in der Darstellung auf zwei Nachkommastellen gerundet; intern wird mit den unveränderten Bewertungen gerechnet.

## 5. Kategorien

Das MVP startet mit fünf festen, für ein gemeinsames Abendessen geeigneten Kategorien. Die Formulierungen verbinden ernsthafte Bewertung mit Urlaubs- und Challenge-Charakter.

| Kategorie | Leitfrage für die Abstimmung |
|---|---|
| Nachschlag-Faktor | Wie lecker war’s? |
| Das Auge isst mit | Wie appetitlich sah das Essen aus? |
| Küchen-Coup | Wie kreativ und stimmig war das Menü? |
| Punktlandung | Haben Garpunkt, Temperatur und Timing gepasst? |
| Gesamterlebnis | Wie stimmig war der Abend insgesamt? |

Skalenhilfe:

- 1 – Noch Luft im Topf
- 2 – Solider Versuch
- 3 – Hat geschmeckt
- 4 – Richtig stark
- 5 – Goldene Kochmütze

Die fünf Kategorien bilden einen sinnvollen Standard. Der Organisator darf Namen und Leitfragen vor Beginn der ersten Abstimmung anpassen. Kategorien hinzuzufügen, zu entfernen oder zu gewichten ist im MVP nicht vorgesehen. Damit bleiben Ergebnisse und Bedienung einfach und vergleichbar.

## 6. Nutzer und Rollen

### Organisator

Der Organisator richtet die Challenge einmalig ein und begleitet ihren Ablauf. Er kann:

- Name der Challenge festlegen;
- Teams, Captains, optionale Jury-Mitglieder, Kochreihenfolge und Termine erfassen;
- die voreingestellten Kategorien vor dem ersten Voting umbenennen;
- für jeden Captain und jedes Jury-Mitglied einen persönlichen Zugangslink abrufen, teilen, kopieren oder als lokal erzeugten QR-Code anzeigen;
- einen Kochabend für die Abstimmung öffnen und schließen;
- den Abstimmungsstatus kontrollieren;
- die finale Auflösung starten.

Der Organisator kann gleichzeitig Captain eines Teams sein. Für das eigene Voting verwendet er wie alle anderen seinen persönlichen Captain-Link.

### Team-Captain

Ein Captain öffnet seinen persönlichen Link und kann:

- den aktuell geöffneten fremden Kochabend bewerten;
- eine Bewertung bis zum Schließen ändern;
- sehen, welche Abstimmungen bereits erledigt sind und welche noch fehlen;
- nach der Auflösung das Gesamtergebnis sehen.

Andere Gäste benötigen keinen Zugang. Sie beraten ihr Team informell; die verbindliche Stimme gibt der Captain ab.

### Jury

Die optionale Jury besteht aus Gästen ohne eigenes Team. Jedes Jury-Mitglied erhält einen persönlichen Link, bewertet jeden Kochabend und sieht denselben Fortschritt und nach der Auflösung dieselben Ergebnisse wie ein Captain. Jury-Mitglieder können nur während der Vorbereitung angelegt, umbenannt oder entfernt werden.

## 7. Kernablauf

### 7.1 Challenge vorbereiten

1. Der Organisator öffnet den geheimen Verwaltungslink.
2. Er legt Name, Teams, Captain-Namen, optionale Jury-Mitglieder, Kochtermine und Kochreihenfolge fest.
3. Er prüft bei Bedarf die fünf Kategorien.
4. Das System erzeugt pro Captain und Jury-Mitglied einen persönlichen, nicht erratbaren Link. Der Organisator kann jeden Zugang zusätzlich als QR-Code anzeigen.
5. Der Organisator teilt die Links über den ohnehin genutzten Messenger.

Es gibt keine Registrierung, E-Mail-Einladung oder Passwortverwaltung.

### 7.2 Kochabend bewerten

1. Der Organisator öffnet nach dem Essen das Voting für den Abend.
2. Der Captain oder das Jury-Mitglied öffnet den persönlichen Link.
3. Die Startseite zeigt direkt den aktuell zu bewertenden Kochabend.
4. Die abstimmende Person vergibt in jeder Kategorie 1 bis 5 Punkte.
5. Vor dem Absenden sieht er eine kompakte Zusammenfassung.
6. Nach dem Absenden bestätigt die Anwendung die gespeicherte Stimme und zeigt den Fortschritt der Challenge.

Der Captain des kochenden Teams sieht den Abend, kann ihn aber nicht bewerten. Die Jury darf jeden Abend bewerten.

### 7.3 Abstimmung schließen

Am folgenden Tag prüft der Organisator lediglich den Status, zum Beispiel „3 von 4 möglichen Stimmen abgegeben“. Einzelbewertungen und Punktstände bleiben verborgen.

Sind alle Stimmen da, schließt er den Abend. Falls eine Stimme fehlt, kann er die betreffende Person außerhalb der Anwendung erinnern oder den Abend trotzdem schließen.

### 7.4 Finale Auflösung

1. Nach dem letzten geschlossenen Kochabend startet der Organisator die Auflösung.
2. Die Anwendung zeigt zunächst die Kategorie-Sieger.
3. Anschließend wird die Gesamtrangliste mit Punktwerten enthüllt.
4. Bei Gleichstand werden mehrere Teams auf demselben Rang ausgezeichnet.
5. Danach bleibt das Ergebnis über die Teilnehmerlinks einsehbar.

Die Auflösung ist bewusst eine gemeinsame Aktion und kein automatisch versendetes Ergebnis.

## 8. Informationsarchitektur und Oberflächen

Das Produkt benötigt nur drei schlanke Ansichten.

### Abstimmungsansicht

Mobile Startseite mit:

- Name und Fortschritt der Challenge;
- prominentem aktuellen Voting;
- abgeschlossenen und noch ausstehenden Kochabenden;
- finalem Ergebnis nach der Auflösung.

### Voting-Ansicht

Eine kompakte, vertikale Bewertung:

- Team und Datum des Kochabends;
- fünf Kategorien mit verständlicher 1-bis-5-Auswahl;
- kurze Skalenhilfe;
- Speichern beziehungsweise Aktualisieren.

### Organisator-Ansicht

Eine funktionale Verwaltungsseite mit:

- Challenge-Konfiguration;
- Teams, Captains und Terminen;
- persönliche Captain- und Jury-Zugänge mit Teilen, Kopieren und QR-Code;
- Status der Kochabende;
- Anzahl abgegebener Stimmen;
- Aktionen „Voting öffnen“, „Voting schließen“ und „Ergebnis auflösen“.

Eine zusätzliche Navigation, Dashboards oder ein allgemeiner Einstellungsbereich sind nicht erforderlich.

## 9. Zustände

### Challenge

- Vorbereitung – Stammdaten können bearbeitet werden.
- Läuft – mindestens ein Kochabend wurde geöffnet; Kategorien und Teams sind gesperrt.
- Aufgelöst – Ergebnisse sind sichtbar; keine weiteren Stimmen möglich.

### Kochabend

- Bevorstehend – noch nicht abstimmbar.
- Offen – berechtigte Captains und Jury-Mitglieder können abstimmen und ihre Stimme ändern.
- Geschlossen – Stimmen können nicht mehr geändert werden.

Ein geschlossener Abend darf vom Organisator wieder geöffnet werden, solange die Challenge noch nicht aufgelöst ist. Das ist die einzige notwendige Korrekturmöglichkeit.

## 10. Leitplanken für Fairness und Vertrauen

- Kein Team kann sich selbst bewerten.
- Individuelle Bewertungen werden nie anderen Stimmberechtigten angezeigt.
- Auch der Organisator sieht vor der Auflösung nur den Teilnahme-, nicht den Punktestand.
- Persönliche Links sind nicht erratbar und dürfen nicht zwischen Personen weitergegeben werden.
- Speichern und Aktualisieren einer Stimme werden eindeutig bestätigt.
- Eine stimmberechtigte Person kann pro Kochabend nur eine aktive Bewertung haben.
- Die Ergebnisauswertung ist für alle Teams identisch.
- Es gibt keine öffentliche, ohne Teilnehmerlink erreichbare Ergebnisliste.

Die Anwendung verarbeitet nur Captain- und Jury-Namen beziehungsweise frei gewählte Anzeigenamen. Weitere persönliche Daten sind nicht erforderlich.

## 11. Technischer Produktzuschnitt

Die Anwendung ist eine responsive, mobile-first Web-Anwendung auf Cloudflare. Für den Produktumfang reichen:

- eine Weboberfläche für Captains, Jury und Organisator;
- eine serverseitige API;
- eine kleine persistente Datenbank, beispielsweise Cloudflare D1;
- zufällige geheime Links als einfache Zugangsmechanik.

Geplante Hintergrundjobs, E-Mail-Versand, externe Identitätsanbieter oder Drittanbieter-Integrationen werden nicht benötigt. Die Anwendung muss nicht offline funktionieren.

Es wird kein eigenes Backup aufgebaut. Ein Verlust der Daten wäre ärgerlich, aber im privaten, zeitlich begrenzten Einsatzfall vertretbar. Normale Datenbankpersistenz und saubere Fehlerbehandlung bleiben selbstverständlich notwendig.

## 12. MVP-Umfang

### Muss enthalten

- eine Challenge mit Teams, Captains, optionaler Jury, Kochreihenfolge und Terminen einrichten;
- fünf voreingestellte Kategorien vor Challenge-Start umbenennen;
- geheime Verwaltungs-, Captain- und Jury-Zugänge ohne Benutzerkonten;
- persönliche Zugänge lokal im Browser als QR-Code anzeigen;
- Kochabende manuell öffnen, schließen und bei Bedarf wieder öffnen;
- Selbstbewertung technisch verhindern;
- mobile Bewertung mit 1 bis 5 Punkten je Kategorie;
- Speichern und Ändern bis zum Schließen;
- Fortschritts- und Abstimmungsstatus;
- vollständig verborgene Zwischenstände;
- automatische Auswertung nach Kategorien und insgesamt;
- gemeinsame finale Auflösung;
- klare Fehler- und Erfolgsrückmeldungen.

### Bewusst nicht im MVP

- Registrierung, Passwörter, E-Mail oder Social Login;
- mehrere Challenges pro Organisator als sichtbare Produktfunktion;
- mehrere Captains pro Team oder Einzelstimmen aller Gäste außerhalb der optionalen Jury;
- frei konfigurierbare Skalen, Kategorieanzahl oder Gewichtungen;
- öffentliche Ranglisten oder Live-Zwischenstände;
- Kommentare, Chat, Fotos, Rezepte oder Menüverwaltung;
- Benachrichtigungen und automatische Erinnerungen;
- Import, Export, Backup und Wiederherstellung;
- komplexe Rollen und Berechtigungen;
- Mehrsprachigkeit;
- Offline-Modus oder native App;
- Analyse-, Tracking- oder Administrationsplattform;
- manipulationssichere Wahl im formalen Sinn.

## 13. Produktentscheidungen und Annahmen

### Entscheidungen

- Frische Einzelbewertungen nach jedem Abend sind wichtiger als eine einmalige Schlussabstimmung.
- Geheime Zwischenstände sind wichtiger als eine laufende Rangliste.
- Persönliche Links sind für die kleine, vertraute Gruppe angemessener als Benutzerkonten.
- Feste Kategorien und gleiche Gewichtung sind verständlicher als flexible Abstimmungsregeln.
- Ein geteilter Sieg ist besser als ein künstlicher Tie-Breaker.
- Manuelles Öffnen und Schließen ist robuster gegenüber verschobenen Essenszeiten als automatische Zeitsteuerung.

### Annahmen für das MVP

- Es gibt mindestens drei Teams und jeweils genau einen Captain.
- Alle Stimmberechtigten nutzen ein aktuelles Smartphone mit Internetzugang.
- Die Gruppe ist klein und grundsätzlich vertrauenswürdig.
- Der Organisator teilt Links über einen vorhandenen Messenger.
- Die Challenge dauert nur einige Tage oder Wochen.
- Alle Teams sollen gleich viele bewertungsberechtigte Gegenstimmen erhalten.

## 14. Risiken und pragmatische Antworten

| Risiko | Antwort im MVP |
|---|---|
| Person verliert ihren Link | Organisator teilt denselben Link erneut |
| Person öffnet den Link eines anderen | persönlicher Link zeigt Name und Rolle deutlich; keine aufwendige Identitätsprüfung |
| Eine Stimme fehlt | Status macht dies sichtbar; Organisator erinnert manuell oder schließt trotzdem |
| Ein Kochabend wird verschoben | Organisator passt den Termin an, solange er noch bevorstehend ist |
| Falsche Bewertung abgeschickt | Stimmberechtigte Person kann sie bis zum Schließen ändern |
| Organisator schließt zu früh | Abend kann vor der finalen Auflösung wieder geöffnet werden |
| Gruppe versucht taktisch zu bewerten | Zwischenstände und Einzelstimmen bleiben verborgen; formale Manipulationssicherheit ist nicht Ziel des Produkts |

## 15. Validierung im ersten Urlaubseinsatz

Der erste echte Einsatz ist zugleich der Produkttest. Beobachtet werden sollte:

- Finden Captains und Jury ohne Erklärung ihr aktuelles Voting?
- Verstehen sie die Kategorien und die Bedeutung der Skala?
- Schließen alle eine Abstimmung in ungefähr einer Minute ab?
- Muss der Organisator häufig erinnern oder Links erneut verteilen?
- Entsteht bei der Auflösung Spannung und ein verständliches Ergebnis?
- Werden Funktionen vermisst, die den Kernablauf tatsächlich blockieren?

Eine Erweiterung ist nur sinnvoll, wenn ein konkretes Problem im echten Ablauf auftritt. „Wäre vielleicht auch nett“ ist für diese Anwendung kein ausreichender Grund.

## 16. Geeigneter Zuschnitt für Umsetzungs-Issues

Die nachgelagerte Anforderungsarbeit kann das MVP in folgende fachliche Pakete zerlegen:

1. Challenge und Teams einrichten
2. Kategorien vorbereiten und nach Start sperren
3. Geheime Organisator- und Captain-Zugänge
4. Kochabend öffnen, schließen und wieder öffnen
5. Captain-Startseite und Challenge-Fortschritt
6. Bewertung erfassen, validieren und ändern
7. Teilnahme-Status für den Organisator
8. Scores berechnen und Gleichstände behandeln
9. Finale Auflösung und Ergebnisansicht
10. Responsive UX, Rückmeldungen und Fehlerfälle
11. Cloudflare-Betrieb und minimale Datenpersistenz

Diese Pakete sind noch keine fertigen Issues. Sie bilden die fachliche Struktur, aus der ein Requirements Engineer testbare Stories und Akzeptanzkriterien ableiten kann.
