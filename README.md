# RH Trainingstagebuch (Modul) · v0.1

Ein Tagebuch-Modul, zwei Verpackungen: diese Standalone-PWA und (folgt) der Einbau in BARRY.
Beide nutzen dieselben Dateien `tagebuch-modul.js` und `rhs-exchange.js`.

## Dateien
| Datei | Zweck |
| --- | --- |
| index.html | Standalone-Rahmen (ein Mensch, beliebig viele Hunde, keine Rollen) |
| tagebuch-modul.js | Kern: Sparten-Konfiguration, Speicher, Erfassung, Auswertung, Import/Export, öffentliche Schnittstelle `TagebuchModul` |
| rhs-exchange.js | Austauschformat v3 (identisch mit dem rhs-exchange-Repository) |
| sw.js, manifest.json, icon-*.png | PWA: Netz-zuerst-Service-Worker, Installation auf dem Startbildschirm |

## Was v0.1 kann
- Mehrere Personen und Hunde: Team = Person + Hund + Sparte entsteht automatisch; ein Hund kann von mehreren Führern, eine Person mehrere Hunde führen; beim Erfassen nur Hund (und ggf. Führer/-in) und Sparte wählen
- Erfassung mit Rahmen, Ort-Vorlagen, Wetter, Km, spartenspezifischen Feldern, Versteckpersonen/Spurleger nur mit Kürzel, Skalen 1–5 plus Freitext, Hundezustand vorher/nachher
- Anzeigearten je Sparte inkl. Kennzeichnung „nicht prüfungsberechtigt“ (Trümmer: Sitzen an Fundstelle)
- Tagebuch mit Spartenfilter, Bearbeiten und Löschen
- Auswertung: Ampel Trainingsrückstand (Gelb ab 6, Rot ab 12 Wochen, einstellbar), Wochenübersicht, Kennzahlen je Sparte, Prüfungsreife-Vorstufe (3 Monate, ≥ 1/Woche, ≥ 80 % erfolgreich)
- Einlesen aller Formate der App-Familie über rhs-exchange: v1/v2/v3, Übergabe-Export und Protokoll-Sicherung der drei Assistenten, Flächen-Auswertungsbogen, Sicherungen der alten Tagebücher (Rettungshundearbeit v2.9.2, Mantrailing v2.0) inkl. Ort-Vorlagen; eigene Sicherung wiederherstellen
- Export: Sicherung (JSON), Austauschpaket v3, CSV, GPX, Druck/PDF
- Schnelle Eingabe: nur Hund, Sparte, Ort und Ergebnis sind sichtbar, alles andere klappt bei Bedarf auf (Details je Sparte, Wetter, Helfer mit einklappbarer Auffindesituation, Hundezustand); „Wie beim letzten Mal“ übernimmt Ort, Km, Ausbilder und Helfer aus dem letzten Eintrag derselben Sparte
- Wetterknopf: nur auf Antippen, holt Temperatur, gefühlte Temperatur, Luftfeuchte, Wind mit Richtung, Böen, Niederschlag bei Open-Meteo (einzige Netzverbindung der App)
- Offline, ohne Server, Daten nur im Gerät (localStorage + IndexedDB-Spiegel)

- Auswertung: Wochenübersicht je Sparte filterbar, Teamfortschritt (letzte drei gegen vorige drei Einheiten, Δ zur Voreinheit), regelbasierte Trainingsempfehlung, Excel-Datei (.xlsx) mit Blatt „Alle Einträge“ und je Sparte allen Detailfeldern – erzeugt im Gerät ohne Netz
- Mantrailing: Wetter beim Legen und beim Arbeiten getrennt, je mit Wetterknopf

## Noch offen (bewusst)
- Prüfungsbausteine je Modul (kommen aus der Prüfungsordnungs-Konfiguration)
- Fotos/Skizzen anzeigen, Karte für Tracks
- Impressum/Datenschutz einsetzen

## Schnittstelle für BARRY
```js
TagebuchModul.start({ rahmen:'barry', root: containerElement, state: barryState.tagebuch, onChange: s => speichern() });
TagebuchModul.import(paket); TagebuchModul.exportPaket(); TagebuchModul.reife(teamId, konfig); TagebuchModul.ampel(teamId); TagebuchModul.statistik(teamId, tage);
```
Getestet: Playwright-Smoke-Test (Team anlegen, Eintrag erfassen, Assistenten-Import, Auswertung, Neuladen) ohne Konsolenfehler.
