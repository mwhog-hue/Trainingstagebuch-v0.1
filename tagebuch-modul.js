/* tagebuch-modul.js — gemeinsamer Kern des Trainingstagebuchs (Standalone-PWA und BARRY)
 * Benötigt rhs-exchange.js (window.RHS).
 * Öffentliche Schnittstelle (für BARRY):
 *   TagebuchModul.start({ rahmen:'standalone'|'barry', root, state?, onChange? })
 *   TagebuchModul.import(paketObjekt)         -> Ergebnis von RHS.merge
 *   TagebuchModul.exportPaket(filter?)        -> rhs-exchange v3 Paket
 *   TagebuchModul.reife(teamId, konfig?)      -> { anteilGut, wochen, bausteineOffen[], ok }
 *   TagebuchModul.statistik(teamId|null, tage)-> Kennzahlen
 *   TagebuchModul.ampel(teamId)               -> 'g'|'a'|'r'|'n'
 *   TagebuchModul.state                       -> das Zustandsobjekt
 *   Ereignisse: document 'tagebuch:changed'
 */
(function (win) {
  'use strict';
  const RHS = win.RHS;
  const KEY = 'rhs-tagebuch-v3';
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = v => JSON.parse(JSON.stringify(v));
  const fmtD = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }); };
  const toLocalInput = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };

  /* ---------- Sparten-Konfiguration (Daten, kein Code) ---------- */
  const SKALEN_STD = [['schwierigkeit', 'Schwierigkeit'], ['hundeleistung', 'Hundeleistung'], ['fuehrerleistung', 'Führung / Taktik'], ['selbststaendigkeit', 'Selbstständigkeit des Hundes'], ['zusammenarbeit', 'Zusammenarbeit']];
  const SPARTEN = {
    flaeche: { label: 'Fläche', anzeige: ['verbeller', 'bringsel', 'freiverweiser', 'rueckverweiser'], rollen: ['Versteckperson', 'unbekannte Zielperson', 'Helfer im Feld', 'Ablenkung'], gruppen: [
      { titel: 'Suchgebiet', felder: [
        { k: 'gelaendeart', l: 'Geländeart', t: 'select', o: [''].concat(["Wald", "Wiese/Weide", "Acker/Feld", "Siedlung/Ortschaft", "Park/Friedhof", "Industrie-/Gewerbegelände", "Steinbruch/Kiesgrube", "Mischgelände", "Sonstiges"]) },
        { k: 'bewuchsdichte', l: 'Bewuchsdichte', t: 'select', o: [''].concat(["frei / kurz", "licht", "mittel", "dicht", "sehr dicht / kaum durchdringbar"]) },
        { k: 'gebietGroesse', l: 'Größe Suchgebiet', t: 'text', ph: 'z. B. 3 ha / 200×300 m' },
        { k: 'suchdauerMin', l: 'Dauer der eigentlichen Suche (Min.)', t: 'number' },
        { k: 'verlaufFormBegrenzung', l: 'Verlauf / Form / Begrenzung des Suchgebiets', t: 'textarea' },
        { k: 'untergruende', l: 'Untergründe', t: 'chips', o: ["Waldboden", "Wiese", "Acker", "Asphalt/Weg", "Schotter", "Sand", "Schnee/Eis", "Wasser/Sumpf", "Sonstiges"] } ] },
      { titel: 'Gelände genauer beschreiben', felder: [
        { k: 'bewuchs', l: 'Bewuchs / Vegetation', t: 'chips', o: ["dornig", "Brennnesseln", "hohes Gras", "dichter Unterwuchs", "Farn", "Jungwuchs", "Totholz", "kaum Bewuchs"] },
        { k: 'gelaendemerkmale', l: 'Geländemerkmale', t: 'chips', o: ["eben", "uneben", "steil/abschüssig", "felsig", "Gräben/Böschungen", "Gewässer/Bachlauf", "Wege/Schneisen", "eingezäunt/begrenzt", "Gebäudeanteil", "schwer zugänglich"] },
        { k: 'belastungen', l: 'Besondere Belastungen', t: 'chips', o: ["Zecken", "Dornen-/Verletzungsgefahr", "Rutschgefahr", "Verkehr", "Publikumsverkehr", "Wildbesatz", "Weidetiere", "Dunkelheit"] },
        { k: 'lichtSicht', l: 'Licht-/Sichtverhältnisse', t: 'select', o: [''].concat(["Tageslicht", "Dämmerung", "Dunkelheit mit Kunstlicht", "Dunkelheit ohne Licht"]) },
        { k: 'bodenwindBeobachtet', l: 'Bodenwind beobachtet', t: 'select', o: [''].concat(["nicht geprüft", "keine erkennbare Bewegung", "sinkt bodennah ab", "steigt nach oben", "zieht gleichmäßig", "wechselnd / verwirbelt"]) },
        { k: 'bodenwind', l: 'Bodenwind / Witterungsverhalten', t: 'text' } ] },
      { titel: 'Suchtaktik', felder: [
        { k: 'laufschema', l: 'Laufschema', t: 'select', o: ['', 'Schleife', 'Zickzack', 'Kamm', 'Quadrantenwechsel', 'frei'] },
        { k: 'stoerungen', l: 'Störungen', t: 'chips', o: ['Wild', 'Spaziergänger', 'Fremdhunde', 'Lärm', 'Verkehr'] },
        { k: 'sichtkontaktHFHund', l: 'Sichtkontakt HF–Hund', t: 'select', o: ['', 'durchgehend', 'überwiegend', 'zeitweise', 'selten'] } ] }
    ], vpGruppen: 'rh' },
    truemmer: { label: 'Trümmer', anzeige: ['verbeller', 'sitzen_fundstelle'], pruefungsberechtigt: ['verbeller'], rollen: ['Versteckperson', 'unbekannte Zielperson', 'Helfer im Feld', 'Ablenkung'], gruppen: [
      { titel: 'Trümmerfeld und Sicherheit', felder: [
        { k: 'truemmerart', l: 'Trümmerobjekt', t: 'chips', o: ["Beton", "Mauerwerk", "Holz", "Mischschutt", "Gebäudeteile", "Fahrzeuge", "Tunnel/Röhre", "Sonstiges"] },
        { k: 'freigabe', l: 'Freigabe / Sicherheitscheck', t: 'select', o: [''].concat(["fachkundig freigegeben", "Ausbildungsbereich freigegeben", "nur definierter sicherer Teil", "nicht geprüft – nicht betreten"]) },
        { k: 'psa', l: 'PSA', t: 'select', o: [''].concat(["vollständig", "teilweise / nach Gefährdungsbeurteilung", "nicht erforderlich im Übungsaufbau", "nicht geprüft"]) },
        { k: 'gefahren', l: 'Gefahren', t: 'chips', o: ["scharfe Kanten", "Splitter", "lose Teile", "Absturz", "Rutschgefahr", "enge Räume", "Dunkelheit", "Lärm", "Staub", "Hitze/Kälte", "beweglicher Untergrund", "Maschinen/Fahrzeuge"] },
        { k: 'sicherheit', l: 'Sicherheit vor der Suche', t: 'chips', o: ['Freigabe eingeholt', 'Tabuzonen markiert', 'Rückzugsweg festgelegt', 'Funkprobe', 'PSA angelegt', 'Hund gecheckt', 'Abbruchsignal vereinbart'] },
        { k: 'zugaenge', l: 'Zugänge / sichere Wege / Tabuzonen', t: 'text' } ] },
      { titel: 'Suchaufbau und Geruchslage', felder: [
        { k: 'suchphase', l: 'Suchaufbau', t: 'chips', o: ["Grobsuche", "Feinsuche/Mikrolokalisierung", "Randbereiche", "Teilsektor", "Gesamttrümmerfeld", "Dunkelheit", "Wiederansatz", "Negativsuche"] },
        { k: 'truemmerUntergruende', l: 'Untergründe / Gerätearbeit im Feld', t: 'chips', o: ["Geröll", "Gitterrost", "Bohle", "Leiter", "Wippe", "bewegliche Brücke", "Röhre/Tunnel", "schmaler Steg", "Höhenwechsel", "instabile Fläche"] },
        { k: 'hohlraum', l: 'Hohlraumsituation', t: 'select', o: [''].concat(["mehrere/verzweigt", "einfacher Hohlraum", "geschlossener Raum", "Tunnel/Kanal", "keine erkennbare", "unbekannt"]) },
        { k: 'geruchslage', l: 'Versteck- und Geruchslage', t: 'chips', o: ["tief verschüttet", "erhöht", "geschlossener Raum", "mehrere Austritte", "Austritt fern der VP", "Verleitung/Altgeruch", "mehrere VP", "leeres Negativgebiet"] },
        { k: 'geruchsaustritte', l: 'Geruchsaustritte / Luftwege', t: 'text' },
        { k: 'geruchspool', l: 'Geruchspool', t: 'text' },
        { k: 'suchdauerMin', l: 'Dauer der eigentlichen Suche (Min.)', t: 'number' } ] },
      { titel: 'Arbeit des Hundes', felder: [
        { k: 'sichtkontakt', l: 'Sichtkontakt', t: 'select', o: [''].concat(["durchgehend", "teilweise", "kein Sichtkontakt", "Dunkelarbeit"]) },
        { k: 'arbeitsdistanz', l: 'Arbeitsdistanz', t: 'select', o: [''].concat(["nah", "mittel", "weit", "wechselnd"]) },
        { k: 'selbststaendigkeit', l: 'Selbstständigkeit', t: 'select', o: [''].concat(["sehr selbstständig", "selbstständig mit kleinen Hilfen", "wechselhaft", "häufige Hilfen", "nicht bewertet"]) },
        { k: 'mikrolokalisierung', l: 'Mikrolokalisierung', t: 'select', o: [''].concat(["präzise an Quelle/Austritt", "gute Eingrenzung", "Geruchspool erkannt, Quelle unsicher", "vorschnelle Anzeige", "keine Lokalisierung", "nicht bewertet"]) },
        { k: 'anzeigeTruemmer', l: 'Anzeige in Trümmern', t: 'select', o: [''].concat(["stabiler Verbeller", "Verbeller mit Pausen", "verzögert", "durch HF gestört", "abgebrochen", "keine Anzeige", "nicht bewertet"]) },
        { k: 'bewegungssicherheit', l: 'Bewegungssicherheit', t: 'select', o: [''].concat(["sicher und flüssig", "vorsichtig aber sicher", "einzelne Unsicherheiten", "deutlich unsicher", "Abbruch aus Sicherheitsgründen", "nicht bewertet"]) },
        { k: 'gehorsamsteil', l: 'Trümmer-Gehorsam mitgeübt', t: 'bool' },
        { k: 'ruhephasenMin', l: 'Ruhephasen Hund gesamt (Min.)', t: 'number' } ] }
    ], vpGruppen: 'rh', vpExtra: ['verschuettungTiefe'] },
    mantrailing: { label: 'Mantrailing', anzeige: ['anspringen', 'anstupsen', 'sitz_platz', 'verbellen'], gruppen: [{ titel: 'Trail', felder: [
      { k: 'trailart', l: 'Trailart', t: 'chips', o: ['Hot Trail', 'Cold Trail', 'Fire Trail', 'Drop Trail', 'Blind', 'Double-blind', 'Negativ-Trail'] },
      { k: 'trailAlterMin', l: 'Trailalter (Min.)', t: 'number' },
      { k: 'trailLaengeM', l: 'Traillänge (m)', t: 'number' },
      { k: 'geruchstraeger', l: 'Geruchsartikel', t: 'chips', o: ['Kleidung', 'Gaze', 'Gegenstand', 'Fahrzeugsitz', 'Türklinke'] },
      { k: 'ansatzart', l: 'Ansatzart', t: 'select', o: ['', 'Startpunkt bekannt', 'Startpunkt unbekannt (PLS)', 'Fahrzeugstart', 'Wiederansatz'] },
      { k: 'ansatzbereich', l: 'Art / Größe des Ansatzbereichs, mögliche Abgänge', t: 'text' },
    ] }, { titel: 'Umfeld und Wetter', felder: [
      { k: 'untergrund', l: 'Untergrund', t: 'chips', o: ['Asphalt', 'Wiese', 'Wald', 'Innenstadt', 'Wohngebiet', 'Gebäude', 'Gewerbe'] },
      { k: 'verleitungen', l: 'Verleitungen', t: 'chips', o: ['Fußgänger', 'Fahrräder', 'Fahrzeuge', 'ÖPNV', 'Hunde / Tiere', 'Gebäude', 'Menschenmenge', 'Alt-/Fremdspur'] },
      { k: 'wetterLegen', l: 'Wetter beim Legen', t: 'textarea', wetterKnopf: true },
      { k: 'wetterArbeiten', l: 'Wetter beim Arbeiten', t: 'textarea', wetterKnopf: true },
      { k: 'temperaturBoden', l: 'Temperatur / Boden', t: 'text' }
    ] }, { titel: 'Sucharbeit', felder: [
      { k: 'startverhalten', l: 'Startverhalten / Ansatz', t: 'text' },
      { k: 'entscheidungspunkte', l: 'Entscheidungspunkte / Hund lesen', t: 'textarea' },
      { k: 'entscheidungssicherheit', l: 'Entscheidungssicherheit', t: 'skala' },
      { k: 'personendifferenzierung', l: 'Personendifferenzierung', t: 'select', o: ['', 'nicht geübt', 'unsicher', 'mit Hilfe', 'sicher', 'sehr sicher'] },
      { k: 'endpool', l: 'Endpool / Auffindesituation', t: 'textarea' },
      { k: 'abweichungMaxM', l: 'Größte Abweichung vom Trail (m)', t: 'number' }
    ] }], skalen: [['finderwille', 'Finderwille'], ['konzentration', 'Konzentration'], ['belastung', 'Belastbarkeit'], ['handlingHF', 'Handling Hundeführer/-in']] },
    gehorsam: { label: 'Gehorsam', felder: [
      { k: 'uebungen', l: 'Übungen', t: 'chips', o: ['Fuß', 'Sitz', 'Platz', 'Bleib', 'Abruf', 'Ablegen unter Ablenkung', 'Voraus', 'Apport', 'Steg', 'Leiter', 'Wippe', 'Tunnel', 'Tragen', 'Abbruch'] },
      { k: 'ablenkung', l: 'Ablenkung', t: 'select', o: ['', 'keine', 'gering', 'mittel', 'hoch'] },
      { k: 'pruefungsbezug', l: 'Prüfungsbezug', t: 'text', ph: 'z. B. Modul 2 Teil B' }
    ] },
    anzeigeverhalten: { label: 'Anzeigetraining', felder: [
      { k: 'aufbau', l: 'Aufbauschritt', t: 'select', o: ['', 'Motivation', 'Anzeige an sichtbarer Person', 'Anzeige verdeckt', 'Haltevermögen', 'Distanz', 'Ablenkung', 'Fremdperson'] },
      { k: 'ablenkungen', l: 'Ablenkungen während der Anzeige', t: 'chips', o: ['Helfer', 'Geräusche', 'Futter', 'Fremdhund', 'Bewegung'] },
      { k: 'wiederholungen', l: 'Wiederholungen', t: 'number' }
    ] },
    gewandtheit: { label: 'Gerätearbeit', felder: [
      { k: 'geraete', l: 'Geräte', t: 'chips', o: ['Leiter', 'Wippe', 'Tunnel', 'Steg', 'Bewegungsloser Untergrund', 'Instabiler Untergrund', 'Tragen', 'Kriechtunnel'] },
      { k: 'sicherung', l: 'Sicherung durch Hundeführer/-in', t: 'text' },
      { k: 'bewegungssicherheit', l: 'Bewegungssicherheit', t: 'skala' }
    ] },
    physio: { label: 'Physio & Fitness', felder: [
      { k: 'warmup', l: 'Warm-up', t: 'chips', o: ['Gehen', 'Traben', 'Slalom', 'Sitz-Steh', 'Pfoten heben'] },
      { k: 'haupt', l: 'Hauptteil', t: 'chips', o: ['Balance', 'Cavaletti', 'Rückwärts', 'Kreise', 'Steigung', 'Schwimmen', 'Massage', 'TTouch'] },
      { k: 'cooldown', l: 'Cool-down', t: 'chips', o: ['Gehen', 'Dehnung', 'Ruhe'] },
      { k: 'wiederholungenHaltezeit', l: 'Wiederholungen / Haltezeit', t: 'text' },
      { k: 'pauseSeitLetzterTage', l: 'Pause seit letzter Physio-Einheit (Tage)', t: 'number' }
    ] },
    alltag: { label: 'Alltag', felder: [
      { k: 'uebungen', l: 'Übungen', t: 'chips', o: ['Leinenführigkeit', 'Warten', 'Ruhe im Café', 'Fahrzeug', 'Treppen', 'Aufzug', 'Menschenmenge', 'Alltagsgeräusche', 'Impulskontrolle'] },
      { k: 'ablenkung', l: 'Ablenkung', t: 'select', o: ['', 'keine', 'gering', 'mittel', 'hoch'] }
    ] },
    alltagstricks: { label: 'Tricks mit Einsatznutzen', felder: [{ k: 'uebungen', l: 'Tricks', t: 'chips', o: ['Foto-Pose auf Podest', 'Kinn ablegen', 'Pfote geben', 'Rolle', 'Rückwärts', 'Zielstab', 'Touch'] }] },
    bindung: { label: 'Bindung & Gelassenheit', felder: [{ k: 'uebungen', l: 'Bausteine', t: 'chips', o: ['Blickkontakt', 'Orientierung', 'Entspannungssignal', 'Ruhe auf Decke', 'Fremde Umgebung', 'Frustrationstoleranz'] }] },
    modul11: { label: 'Modul 1.1 Grundfertigkeiten', felder: [{ k: 'uebungen', l: 'Prüfungsteile', t: 'chips', o: ['Verhalten Menschen', 'Verhalten Hunde', 'Verhalten Geräusche', 'Untersuchbarkeit', 'Ablegen', 'Abruf', 'Leinenführigkeit'] }] },
    sonstiges: { label: 'Sonstiges', felder: [{ k: 'beschreibung', l: 'Beschreibung', t: 'textarea' }] }
  };
  const VP_FELDER = {
    alterCa: { l: 'Alter (ca.)', t: 'number' }, geschlecht: { l: 'Geschlecht', t: 'select', o: [''].concat(["m", "w", "d"]) },
    bekanntFuerHund: { l: 'Bekanntheit für den Hund', t: 'select', o: [''].concat(["unbekannt", "flüchtig bekannt", "gut bekannt"]) }, erfahrung: { l: 'Erfahrung als Helfer', t: 'select', o: [''].concat(["erstmalig", "wenig erfahren", "erfahren"]) },
    versteckart: { l: 'Versteckart / Position', t: 'select', o: [''].concat(["offen ebenerdig", "erhöht (Baum/Fahrzeug/Dach)", "verdeckt (Gebüsch/Graben)", "in Gebäude/Raum", "im Wasser", "unter Trümmern / im Hohlraum", "bewegte Person", "sonstiges"]) }, sichtbar: { l: 'Sichtbarkeit für den Hund', t: 'select', o: [''].concat(["frei sichtbar", "teilweise verdeckt", "vollständig verdeckt"]) },
    verhaltenImVersteck: { l: 'Verhalten im Versteck', t: 'select', o: [''].concat(["ruhig sitzend", "ruhig liegend", "stehend", "unruhig", "sich bewegend", "rufend / Geräusche", "schlafend / regungslos", "sonstiges"]) }, geruchsintensitaet: { l: 'Geruchsintensität / Liegezeit', t: 'select', o: [''].concat(["frisch / normal", "starkes Geruchsbild", "schwach / gealtert", "Geruch abgeschirmt", "nicht beurteilt"]) },
    zugaenglichkeit: { l: 'Zugänglichkeit', t: 'select', o: [''].concat(["gut erreichbar", "erschwert erreichbar", "nur kriechend erreichbar", "nur kletternd erreichbar", "für Hund nicht direkt erreichbar"]) }, zeitImVersteck: { l: 'Zeit im Versteck vor Suchbeginn', t: 'text', ph: 'z. B. 10 Min' },
    hoeheTiefe: { l: 'Höhe / Tiefe', t: 'text', ph: 'z. B. 1,5 m' }, lageImGebiet: { l: 'Lage im Suchgebiet', t: 'text', ph: 'z. B. Randbereich' },
    geruchsaustritt: { l: 'Geruchsaustritt / Windbezug', t: 'text', ph: 'z. B. Austritt nach Osten' }, ablenkungen: { l: 'Individuelle Ablenkungen / Besonderheiten', t: 'textarea' },
    verschuettungTiefe: { l: 'Verschüttung / Tiefe', t: 'text' },
    zeitBisFundMin: { l: 'Zeit bis Fund / Anzeige (Min.)', t: 'number' }, verlaufDerSuche: { l: 'Verlauf der Suche / Suchqualität', t: 'select', o: [''].concat(["– nicht bewertet –", "motiviert und schnell", "motiviert, aber langsam", "konzentriert, aber langsam", "unkonzentriert", "ablenkbar", "unmotiviert", "übermotiviert / hektisch", "Motivation zunehmend", "Motivation nachlassend", "nicht bewertet"]) },
    fuehrbarkeit: { l: 'Führbarkeit des Hundes im Gelände', t: 'select', o: [''].concat(["– nicht bewertet –", "sehr gut – selbstständig und jederzeit ansprechbar", "gut – kleine Hilfen nötig", "wechselhaft führbar", "eingeschränkt – häufige Hilfen nötig", "schwer führbar / kaum ansprechbar", "nicht bewertet"]) }, bewertungText: { l: 'Bewertung', t: 'select', o: [''].concat(["– nicht bewertet –", "sehr gut", "gut", "befriedigend", "ausreichend", "mangelhaft"]) },
    anzeigequalitaetText: { l: 'Anzeigequalität (Beschreibung)', t: 'select', o: [''].concat(["– nicht bewertet –", "spontan und sauber", "sicher und anhaltend", "kurz / unterbrochen", "verzögert", "musste bestätigt werden", "abgelenkt", "unmotiviert", "Anzeige abgebrochen", "keine Anzeige", "nicht zutreffend"]) },
    latenzSek: { l: 'Latenz Auffinden → Anzeige (Sek.)', t: 'number' }, haltevermoegenSek: { l: 'Haltevermögen / Anzeigedauer (Sek.)', t: 'number' }, distanzHFHundM: { l: 'Distanz HF–Hund bei Anzeigebeginn (m)', t: 'number' },
    chipsVerhalten: { l: 'Verhalten an der Person', t: 'chips', o: ["Abstand gehalten", "Person berührt", "Person bedrängt", "angesprungen", "beleckt", "beschnüffelt / abgesucht", "ruhig bei der Person geblieben", "zurückgewichen / unsicher"] }, fehlverhalten: { l: 'Fehlverhalten bei der Anzeige', t: 'text' }, notiz: { l: 'Beobachtung', t: 'textarea' }
  };
  const GEFUNDEN_OPT = [''].concat(["ja, selbstständig", "ja, mit Unterstützung", "nur Witterung aufgenommen", "überlaufen / nicht gefunden", "nicht bewertet"]);
  const VP_GRUPPEN = {
    rh: [{ titel: 'Person', felder: ['alterCa', 'geschlecht', 'bekanntFuerHund', 'erfahrung'] },
      { titel: 'Individuelle Auffindesituation', felder: ['versteckart', 'sichtbar', 'verhaltenImVersteck', 'geruchsintensitaet', 'zugaenglichkeit', 'zeitImVersteck', 'hoeheTiefe', 'lageImGebiet', 'geruchsaustritt', 'ablenkungen'] },
      { titel: 'Individuelles Ergebnis', felder: ['zeitBisFundMin', 'verlaufDerSuche', 'fuehrbarkeit', 'bewertungText', 'anzeigequalitaetText', 'latenzSek', 'haltevermoegenSek', 'distanzHFHundM', 'chipsVerhalten', 'fehlverhalten', 'notiz'] }],
    mt: [{ titel: 'Person', felder: ['alterCa', 'geschlecht', 'bekanntFuerHund', 'erfahrung'] }, { titel: 'Ergebnis', felder: ['zeitBisFundMin', 'chipsVerhalten', 'fehlverhalten', 'notiz'] }],
    anzeige: [{ titel: 'Auffindesituation', felder: ['sichtbar', 'verhaltenImVersteck', 'latenzSek', 'haltevermoegenSek', 'distanzHFHundM', 'fehlverhalten', 'notiz'] }]
  };
  const vpGruppenFuer = cfg => { const g = cfg.vpGruppen === 'rh' ? VP_GRUPPEN.rh.map(x => Object.assign({}, x, { felder: x.titel === 'Individuelle Auffindesituation' ? x.felder.concat(cfg.vpExtra || []) : x.felder })) : cfg === SPARTEN.mantrailing ? VP_GRUPPEN.mt : cfg === SPARTEN.anzeigeverhalten ? VP_GRUPPEN.anzeige : VP_GRUPPEN.mt; return g; };
  Object.values(SPARTEN).forEach(c => { if (!c.gruppen) c.gruppen = [{ titel: 'Details ' + c.label, felder: c.felder || [] }]; c.felder = c.gruppen.flatMap(g => g.felder); if (!c.rollen) c.rollen = c === SPARTEN.mantrailing ? ['Spurleger', 'Versteckperson', 'Helfer', 'Ablenkung'] : ['Versteckperson', 'Helfer', 'Ablenkung']; });
  const ANZ_LABEL = { verbeller: 'Verbeller', bringsel: 'Bringsel', freiverweiser: 'Freiverweiser', rueckverweiser: 'Rückverweiser', anspringen: 'Anspringen', anstupsen: 'Anstupsen', sitz_platz: 'Sitz/Platz bei Person', verbellen: 'Verbellen', sitzen_fundstelle: 'Sitzen an Fundstelle (nicht prüfungsberechtigt)' };
  const ERG_LABEL = { offen: 'offen', erfolgreich: 'erfolgreich', teilweise: 'teilweise', nicht_erfolgreich: 'nicht erfolgreich', abgebrochen: 'abgebrochen' };

  const CSS = `.tbm{--tbm:1;
  --bg:#F7F8F5;--paper:#FFFFFF;--ink:#1F2A24;--muted:#5D6B62;--line:#D9DED8;
  --green:#2F5D3A;--green-soft:#E3ECDF;--moss:#8AA86B;--amber:#C9932B;--amber-soft:#F6EBD2;--red:#B4432D;--red-soft:#F5DFD9;
  --r:12px;--tap:44px;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.4;
  box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);
}@media(prefers-color-scheme:dark){html:not([data-theme=light]) .tbm{--bg:#141816;--paper:#1C221E;--ink:#E8ECE7;--muted:#9AA79E;--line:#2C352F;--green:#7FB08A;--green-soft:#22301F;--amber-soft:#3A2F14;--red-soft:#3D1E18}}.tbm[data-theme=dark],html[data-theme=dark] .tbm{--bg:#141816;--paper:#1C221E;--ink:#E8ECE7;--muted:#9AA79E;--line:#2C352F;--green:#7FB08A;--green-soft:#22301F;--amber-soft:#3A2F14;--red-soft:#3D1E18}.tbm *{box-sizing:inherit}.tbm, .tbm{height:100%;margin:0;background:var(--bg);color:var(--ink)}.tbm{display:flex;flex-direction:column}.tbm header{padding:14px 16px 8px;display:flex;align-items:baseline;justify-content:space-between;gap:12px}.tbm header h1{font-size:1.15rem;margin:0;font-weight:650;letter-spacing:-.01em}.tbm header h1 small{font-weight:400;color:var(--muted);font-size:.8rem;margin-left:6px}.tbm #teamchip{font-size:.85rem;color:var(--green);background:var(--green-soft);padding:6px 10px;border-radius:999px;border:0;font:inherit;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tbm main{flex:1;overflow:auto;padding:0 16px calc(84px + env(safe-area-inset-bottom,0px))}.tbm nav.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--paper);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom,0px)}.tbm nav.tabs button{flex:1;min-height:58px;border:0;background:none;font:inherit;font-size:.72rem;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:8px}.tbm nav.tabs button span.i{font-size:1.25rem;line-height:1}.tbm nav.tabs button[aria-current=page]{color:var(--green);font-weight:650}.tbm section.view{display:none}.tbm section.view.active{display:block}.tbm h2{font-size:1.05rem;margin:18px 0 8px;font-weight:650}.tbm h3{font-size:.95rem;margin:14px 0 6px;font-weight:650;color:var(--muted)}.tbm p.lead{color:var(--muted);margin:0 0 12px}.tbm .card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin:10px 0}.tbm details.card{padding:0}.tbm details.card>summary{padding:12px 14px;cursor:pointer;font-weight:600;list-style:none;display:flex;justify-content:space-between;align-items:center}.tbm details.card>summary::after{content:"+";color:var(--muted);font-weight:400}.tbm details[open].card>summary::after{content:"–"}.tbm details.card>div{padding:0 14px 12px}.tbm label.f{display:block;margin:10px 0}.tbm label.f>span{display:block;font-size:.82rem;color:var(--muted);margin-bottom:4px}.tbm input, .tbm select, .tbm textarea{width:100%;min-height:var(--tap);font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}.tbm textarea{min-height:72px;resize:vertical}.tbm input[type=checkbox]{width:auto;min-height:auto;transform:scale(1.3);margin-right:8px}.tbm .row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}.tbm .chips{display:flex;flex-wrap:wrap;gap:6px}.tbm .chip{border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:7px 12px;font:inherit;font-size:.88rem;min-height:36px}.tbm .chip.on{background:var(--green);border-color:var(--green);color:#fff}.tbm .skala{display:flex;gap:6px}.tbm .skala button{flex:1;min-height:var(--tap);border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;font:inherit;font-weight:600}.tbm .skala button.on{background:var(--green);color:#fff;border-color:var(--green)}.tbm button.primary{width:100%;min-height:52px;border:0;border-radius:var(--r);background:var(--green);color:#fff;font:inherit;font-weight:650;font-size:1rem;margin:14px 0 6px}.tbm button.ghost{min-height:var(--tap);border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit;padding:0 14px}.tbm button.ghost.danger{color:var(--red);border-color:var(--red)}.tbm .btnrow{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.tbm .big{display:grid;grid-template-columns:1fr 1fr;gap:8px}.tbm .big button{min-height:64px;border:1px solid var(--line);border-radius:var(--r);background:var(--paper);color:var(--ink);font:inherit;font-weight:600;font-size:.95rem}.tbm .big button.on{background:var(--green);color:#fff;border-color:var(--green)}.tbm .entry{display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}.tbm .entry:last-child{border-bottom:0}.tbm .entry b{display:block}.tbm .entry small{color:var(--muted)}.tbm .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}.tbm .dot.g{background:var(--green)}.tbm .dot.a{background:var(--amber)}.tbm .dot.r{background:var(--red)}.tbm .dot.n{background:var(--line)}.tbm .ampel{padding:10px 12px;border-radius:8px;margin:6px 0;display:flex;justify-content:space-between;align-items:center;gap:10px}.tbm .ampel small{text-align:right;flex-shrink:0;max-width:48%}.tbm .ampel.g{background:var(--green-soft)}.tbm .ampel.a{background:var(--amber-soft)}.tbm .ampel.r{background:var(--red-soft)}.tbm .bars{display:flex;align-items:flex-end;gap:4px;height:90px;border-bottom:1px solid var(--line);padding-bottom:2px}.tbm .bars div{flex:1;background:var(--moss);border-radius:3px 3px 0 0;position:relative;min-height:2px}.tbm .bars div span{position:absolute;top:100%;left:0;right:0;text-align:center;font-size:.65rem;color:var(--muted);margin-top:3px}.tbm .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(76px + env(safe-area-inset-bottom,0px));background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:.9rem;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.tbm .toast.show{opacity:1}.tbm input,.tbm select,.tbm textarea,.tbm button{box-sizing:border-box;max-width:100%;margin:0}.tbm .vpdet .row{margin-top:4px}
.tbm .vpdet{margin:6px 0}.tbm .vpdet>summary{list-style:none;padding:6px 0}.tbm .vpdet>summary::before{content:"▸ "}.tbm .vpdet[open]>summary::before{content:"▾ "}
.tbm .rep{border-left:3px solid var(--moss);padding-left:10px;margin:8px 0}.tbm .hint{font-size:.82rem;color:var(--muted)}.tbm .erg{margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--green-soft);font-size:.9rem}.tbm .erg.bad{background:var(--red-soft)}.tbm .erg b{display:block}.tbm .empty{text-align:center;color:var(--muted);padding:26px 10px}.tbm table{width:100%;border-collapse:collapse;font-size:.9rem}.tbm td, .tbm th{text-align:left;padding:6px 4px;border-bottom:1px solid var(--line);vertical-align:top}.tbm kbd{font-family:inherit;background:var(--green-soft);padding:1px 6px;border-radius:4px}.tbm :focus-visible{outline:2px solid var(--amber);outline-offset:2px}@media(prefers-reduced-motion:reduce){.tbm *{transition:none!important}}
.tbm{display:flex;flex-direction:column;min-height:100%;font-size:16px;line-height:1.4;color:var(--ink);background:var(--bg)}
.tbm.standalone{height:100%}
.tbm.standalone header,.tbm.standalone main,.tbm.standalone nav.tabs{}
.tbm.eingebettet,html:not([data-theme=dark]) .tbm.eingebettet{--bg:#F7F8F5;--paper:#FFFFFF;--ink:#1F2A24;--muted:#5D6B62;--line:#D9DED8;--green:#2F5D3A;--green-soft:#E3ECDF;--amber-soft:#F6EBD2;--red-soft:#F5DFD9;color-scheme:light;min-height:auto;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.tbm.eingebettet main{overflow:visible;padding-bottom:16px}
.tbm.eingebettet nav.tabs{position:sticky;top:0;bottom:auto;border-top:0;border-bottom:1px solid var(--line);z-index:2;padding-bottom:0}
.tbm.eingebettet header{display:none}
.tbm.eingebettet .toast{position:sticky;bottom:12px;left:auto;transform:none;margin:0 auto;display:table}
`;
  const MARKUP = `<header>
  <h1>Trainingstagebuch <small>v0.1</small></h1>
  <button id="teamchip" title="Team wechseln">Kein Team</button>
</header>
<main>

<!-- ===== Start ===== -->
<section class="view active" id="v-start">
  <p class="lead" id="startlead">Willkommen. Lege zuerst Hund und Team an, dann kannst du Trainings erfassen.</p>
  <div id="startampel"></div>
  <h2>Zuletzt</h2>
  <div class="card" id="startletzte"></div>
  <button class="primary" data-go="erfassen">Training erfassen</button>
</section>

<!-- ===== Erfassen ===== -->
<section class="view" id="v-erfassen">
  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 id="erfassen-titel">Training erfassen</h2><div class="chips" id="e-umfang"><button type="button" class="chip" data-v="kompakt">Kompakt</button><button type="button" class="chip" data-v="ausfuehrlich">Ausführlich</button></div></div>
  <div class="card">
    <div class="row"><label class="f"><span>Hund</span><select id="e-hund"></select></label><label class="f" id="e-person-wrap"><span>Geführt von</span><select id="e-person"></select></label></div>
    <div class="row">
      <label class="f"><span>Art</span><select id="e-typ"><option value="training">Training</option><option value="pruefung">Prüfung</option><option value="einsatz">Einsatz</option><option value="vorfuehrung">Vorführung</option><option value="sonstiges">Sonstiges</option></select></label>
      <label class="f"><span>Beginn</span><input type="datetime-local" id="e-beginn"></label>
    </div>
    <label class="f"><span>Dauer (Minuten)</span><input type="number" id="e-dauer" inputmode="numeric" min="0"></label>
  </div>
  <h3>Sparte</h3>
  <div class="big" id="e-sparten"></div>
  <div class="card">
    <label class="f"><span>Ort</span><input id="e-ort" list="ortliste" placeholder="Trainingsgelände"><datalist id="ortliste"></datalist></label>
    <div class="btnrow"><button class="ghost" id="e-wielet" type="button">Wie beim letzten Mal</button><button class="ghost" id="e-ortmerken" type="button">Ort als Vorlage merken</button></div>
  </div>
  <details class="card"><summary>Wetter und Anfahrt</summary><div>
    <div class="btnrow"><button class="ghost" id="e-wetter" type="button">🌐 Wetter jetzt übernehmen</button><button class="ghost" id="e-gps" type="button">Position übernehmen</button></div>
    <p class="hint">Der Wetterabruf fragt nur nach Antippen die Position ab und holt die Werte bei Open-Meteo; sonst arbeitet die App ohne Netz.</p>
    <p class="hint" id="e-wetter-info"></p>
    <div class="row">
      <label class="f"><span>Temperatur °C</span><input type="number" id="e-temp" inputmode="decimal"></label>
      <label class="f"><span>Wind km/h</span><input type="number" id="e-wind" inputmode="decimal"></label>
    </div>
    <div class="row">
      <label class="f"><span>Windrichtung</span><select id="e-windr"><option value="">–</option><option>N</option><option>NO</option><option>O</option><option>SO</option><option>S</option><option>SW</option><option>W</option><option>NW</option><option>variabel</option></select></label>
      <label class="f"><span>Niederschlag</span><select id="e-nied"><option value="">–</option><option>trocken</option><option>Nieselregen</option><option>Regen</option><option>Schnee</option><option>Nebel</option></select></label>
    </div>
    <label class="f"><span>Entfernung von zu Hause (km, Hin- und Rückfahrt)</span><input type="number" id="e-km" inputmode="decimal"></label>
  </div></details>
  <div id="e-sparte-felder"></div>
  <details class="card"><summary>Helfer und Versteckpersonen</summary><div>
    <p class="hint">Nur Kürzel, keine Namen – das ist in der ganzen App-Familie so festgelegt.</p>
    <div id="e-vps"></div>
    <button class="ghost" type="button" id="e-vp-add">+ Versteckperson / Spurleger</button>
    <label class="f"><span>Ausbilder/-in (Kürzel)</span><input id="e-ausbilder" maxlength="4"></label>
  </div></details>
  <details class="card" open data-immer><summary>Ergebnis und Bewertung</summary><div>
    <label class="f"><span>Ergebnis</span><select id="e-ergebnis"><option value="offen">offen</option><option value="erfolgreich">erfolgreich</option><option value="teilweise">teilweise</option><option value="nicht_erfolgreich">nicht erfolgreich</option><option value="abgebrochen">abgebrochen</option></select></label>
    <div id="e-skalen"></div>
    <label class="f"><span>Nächster kleinster Trainingsschritt</span><input id="e-naechster"></label>
    <label class="f"><span>Beobachtung / Freitext</span><textarea id="e-freitext"></textarea></label>
  </div></details>
  <details class="card"><summary>Hund vor und nach dem Training</summary><div>
    <label class="f"><span>Gesundheitszustand vor dem Training</span><input id="e-hv" list="dl-hv"></label>
    <label class="f"><span>Zustand nach dem Training</span><input id="e-hn" list="dl-hn"></label>
    <label class="f"><span>Ermüdungs-/Schmerzanzeichen</span><input id="e-ha" list="dl-ha"></label>
    <datalist id="dl-hv"><option>fit / unauffällig</option><option>leichte Einschränkung</option><option>Rücksprache Tierarzt/Physio nötig</option></datalist>
    <datalist id="dl-hn"><option>munter</option><option>ruhig/entspannt</option><option>erschöpft</option><option>angespannt</option></datalist>
    <datalist id="dl-ha"><option>keine</option><option>leichtes Zittern</option><option>Vermeidungsverhalten</option><option>Humpeln</option></datalist>
  </div></details>
  <button class="primary" id="e-save">Eintrag speichern</button>
  <div class="btnrow"><button class="ghost" id="e-cancel" type="button">Abbrechen</button><button class="ghost danger" id="e-delete" type="button" hidden>Eintrag löschen</button></div>
</section>

<!-- ===== Tagebuch ===== -->
<section class="view" id="v-tagebuch">
  <h2>Tagebuch</h2>
  <div class="chips" id="t-filter"></div>
  <div class="card" id="t-liste"></div>
</section>

<!-- ===== Auswertung ===== -->
<section class="view" id="v-auswertung">
  <h2>Auswertung</h2>
  <div id="a-ampel"></div>
  <details class="card" open><summary>Trainings je Woche (12 Wochen)</summary><div><div class="chips" id="a-wfilter" style="margin-bottom:8px"></div><div class="bars" id="a-wochen"></div><p class="hint" id="a-wochen-txt"></p></div></details>
  <details class="card" open><summary>Teamfortschritt</summary><div id="a-fortschritt"></div></details>
  <details class="card" open><summary>Trainingsempfehlung</summary><div id="a-empfehlung"></div></details>
  <details class="card"><summary>Excel-Auswertung</summary><div><p class="hint">Erzeugt eine Excel-Datei (.xlsx) direkt im Gerät, ohne Netz: ein Blatt „Alle Einträge“ und je Sparte ein Blatt mit allen Detailfeldern.</p><div class="btnrow"><button class="ghost" id="a-xlsx" type="button">Excel-Datei erzeugen</button></div></div></details>
  <details class="card" open><summary>Je Sparte</summary><div><table id="a-sparten"></table></div></details>
  <details class="card"><summary>Prüfungsreife</summary><div id="a-reife"></div></details>
</section>

<!-- ===== Team ===== -->
<section class="view" id="v-team">
  <h2>Personen, Hunde und Teams</h2>
  <p class="lead">Hund einmal anlegen und Sparten ankreuzen – die Teams je Sparte entstehen automatisch. Beim Erfassen wählst du nur Hund und Sparte.</p>
  <div class="card">
    <h3>Hundeführer/-innen</h3>
    <div id="personenliste"></div>
    <div class="row"><label class="f"><span>Name</span><input id="p-name" placeholder="Anzeigename"></label><label class="f"><span>Organisation (optional)</span><input id="p-org" placeholder="z. B. Staffel"></label></div>
    <button class="ghost" id="p-save" type="button">+ Person hinzufügen</button>
    <p class="hint">Mehrere Personen sind sinnvoll, wenn ein Hund von zwei Führern gearbeitet wird oder sich zwei Personen ein Gerät teilen.</p>
  </div>
  <div id="hundeliste"></div>
  <details class="card"><summary>Hund hinzufügen</summary><div>
    <label class="f"><span>Rufname</span><input id="h-name"></label>
    <div class="row"><label class="f"><span>Geboren</span><input type="date" id="h-geb"></label><label class="f"><span>Rasse</span><input id="h-rasse"></label></div>
    <span class="hint">Sparten</span><div class="chips" id="h-sparten"></div>
    <button class="primary" id="h-save">Hund und Teams anlegen</button>
  </div></details>
</section>

<!-- ===== Daten ===== -->
<section class="view" id="v-daten">
  <h2>Daten</h2>
  <details class="card" open><summary>Einlesen</summary><div>
    <p class="hint">Nimmt JSON-Dateien der RH-App-Familie an: Übergabe-Export und Protokoll-Sicherung der Assistenten, Team-Austausch (rhs-exchange), Sicherungen dieses Tagebuchs. CSV-Tabellen sind nur zum Lesen in Excel gedacht und werden nicht eingelesen.</p>
    <input type="file" id="d-import" accept=".json,application/json" multiple>
    <div id="d-import-erg" hidden></div>
  </div></details>
  <details class="card" open><summary>Sichern und weitergeben</summary><div>
    <div class="btnrow">
      <button class="ghost" id="d-backup">Vollständige Sicherung (JSON)</button>
      <button class="ghost" id="d-v3">Austauschpaket rhs-exchange v3</button>
      <button class="ghost" id="d-csv">Tabelle (CSV für Excel)</button>
      <button class="ghost" id="d-gpx">Tracks als GPX</button>
      <button class="ghost" id="d-print">Drucken / PDF</button>
    </div>
    <p class="hint">Sicherung: alles inkl. Heimatpunkt, nur für dich. Austauschpaket: ohne Heimatpunkt, ohne Chipnummer, Helfer nur als Kürzel.</p>
  </div></details>
  <details class="card"><summary>Einstellungen</summary><div>
    <label class="f"><span>Darstellung</span><select id="d-theme"><option value="">System</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></label>
    <label class="f"><span>Ampel Gelb ab (Wochen ohne Training)</span><input type="number" id="d-gelb" value="6"></label>
    <label class="f"><span>Ampel Rot ab (Wochen)</span><input type="number" id="d-rot" value="12"></label>
    <div class="btnrow"><button class="ghost danger" id="d-reset">Alle Daten löschen</button></div>
  </div></details>
  <details class="card"><summary>Hilfe, Impressum, Datenschutz</summary><div id="d-hilfe">
    <p>Das Tagebuch läuft offline auf diesem Gerät; Einträge verlassen es nur, wenn du sie selbst exportierst. Einzige Ausnahme: der Knopf „Wetter jetzt übernehmen“ fragt nach Antippen deine Position ab und ruft die Wetterwerte bei Open-Meteo (open-meteo.com) ab – ohne Konto, ohne Übermittlung weiterer Daten. Zum Installieren: im Browser „Zum Startbildschirm hinzufügen“.</p>
    <p>Datenformat: <kbd>rhs-exchange v3</kbd> – offen dokumentiert, damit auch andere Apps es lesen können.</p>
    <p class="hint">Impressum und Datenschutzerklärung: werden vor Veröffentlichung eingesetzt.</p>
  </div></details>
</section>
</main>
<nav class="tabs">
  <button data-go="start" aria-current="page"><span class="i">⌂</span>Start</button>
  <button data-go="erfassen"><span class="i">＋</span>Erfassen</button>
  <button data-go="tagebuch"><span class="i">≡</span>Tagebuch</button>
  <button data-go="auswertung"><span class="i">◔</span>Auswertung</button>
  <button data-go="team"><span class="i">🐾</span>Team</button>
  <button data-go="daten"><span class="i">⇅</span>Daten</button>
</nav>
<div class="toast" id="toast"></div>`;
  function markupEinsetzen(container, modus) { if (!document.getElementById('tbm-style')) { const st = document.createElement('style'); st.id = 'tbm-style'; st.textContent = CSS; document.head.appendChild(st); } container.classList.add('tbm', modus === 'barry' ? 'eingebettet' : 'standalone'); if (!container.querySelector('main')) { container.innerHTML = MARKUP; if (modus === 'barry') { const nav = container.querySelector('nav.tabs'); container.insertBefore(nav, container.querySelector('main')); } } }

  /* ---------- Zustand ---------- */
  let state, opts = {};
  function leer() { const p = { id: 'p-' + RHS.hilfen.uid().slice(3), name: '', organisation: '' }; return { version: 2, person: p, personen: [p], hunde: [], teams: [], records: [], orte: [], heimatpunkt: null, einstellungen: { gelb: 6, rot: 12, theme: '' } }; }
  function migriere(s) { if (!s.personen) s.personen = [s.person]; if (!s.person) s.person = s.personen[0]; s.version = 2; return s; }
  function laden() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version) return migriere(s); } catch (e) { } return leer(); }
  const person = id => state.personen.find(p => p.id === id);
  function speichern() { if (!opts.state) { try { localStorage.setItem(KEY, JSON.stringify(state)); idbMirror(); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); } } if (opts.onChange) opts.onChange(state); document.dispatchEvent(new CustomEvent('tagebuch:changed')); }
  function idbMirror() { try { const r = indexedDB.open('rhs-tagebuch', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ t: Date.now(), state }, 'state'); }; } catch (e) { } }
  const sichtbarerHund = h => !opts.hundFilter || opts.hundFilter(h);
  const eintraege = () => state.records.filter(r => r.type === 'entry' && (!opts.hundFilter || sichtbarerHund(hund((team(r.data.teamId) || {}).hundId) || {})));
  const team = id => state.teams.find(t => t.id === id);
  const hund = id => state.hunde.find(h => h.id === id);
  const teamLabel = t => { if (!t) return '–'; const mehrere = state.personen.length > 1; return (hund(t.hundId) || {}).rufname + (mehrere ? ' (' + ((person(t.personId) || {}).name || '?') + ')' : '') + ' · ' + (SPARTEN[t.sparte] || {}).label; };
  function teamFuer(personId, hundId, sparte, anlegen) { let t = state.teams.find(x => x.hundId === hundId && x.sparte === sparte && x.personId === personId); if (!t && anlegen) { t = { id: 'team-' + RHS.hilfen.uid().slice(3), personId, hundId, sparte, status: 'in_ausbildung', anzeigeart: '' }; state.teams.push(t); const h = hund(hundId); if (h && !h.sparten.includes(sparte)) h.sparten.push(sparte); } return t; }

  /* ---------- Auswertung ---------- */
  function wochenSeit(teamId) { const es = eintraege().filter(e => e.data.teamId === teamId && e.data.typ !== 'einsatz'); if (!es.length) return null; const last = Math.max(...es.map(e => Date.parse(e.data.beginn))); return (Date.now() - last) / 6048e5; }
  function ampel(teamId) { const w = wochenSeit(teamId); if (w == null) return 'n'; const k = state.einstellungen; return w >= (k.rot || 12) ? 'r' : w >= (k.gelb || 6) ? 'a' : 'g'; }
  function statistik(teamId, tage, sparte) {
    const seit = Date.now() - (tage || 365) * 864e5;
    const es = eintraege().filter(e => (!teamId || e.data.teamId === teamId) && (!sparte || e.data.sparte === sparte) && Date.parse(e.data.beginn) >= seit);
    const gut = es.filter(e => e.data.bewertung.ergebnis === 'erfolgreich');
    const sk = k => { const v = es.map(e => e.data.bewertung[k]).filter(x => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const wochen = {}; es.forEach(e => { const d = new Date(e.data.beginn); const ws = new Date(d); ws.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = ws.toISOString().slice(0, 10); wochen[k] = (wochen[k] || 0) + 1; });
    return { anzahl: es.length, erfolgreich: gut.length, anteilGut: es.length ? gut.length / es.length : null, schnitt: { schwierigkeit: sk('schwierigkeit'), hundeleistung: sk('hundeleistung'), fuehrerleistung: sk('fuehrerleistung') }, wochen };
  }
  function reife(teamId, konfig) {
    konfig = Object.assign({ monate: 3, anteilGut: 0.8, mindestNote: 4, proWoche: 1, bausteine: [] }, konfig || {});
    const seit = Date.now() - konfig.monate * 30.44 * 864e5;
    const es = eintraege().filter(e => e.data.teamId === teamId && Date.parse(e.data.beginn) >= seit);
    const gut = es.filter(e => e.data.bewertung.ergebnis === 'erfolgreich' && (e.data.bewertung.hundeleistung == null || e.data.bewertung.hundeleistung >= konfig.mindestNote));
    const wochen = konfig.monate * 4.35;
    const bausteineOffen = konfig.bausteine.filter(b => !es.some(e => e.data.bewertung.ergebnis === 'erfolgreich' && JSON.stringify(e.data.nutzlast).toLowerCase().includes(b.toLowerCase())));
    const r = { eintraege: es.length, anteilGut: es.length ? gut.length / es.length : 0, proWoche: es.length / wochen, bausteineOffen };
    r.ok = r.eintraege > 0 && r.anteilGut >= konfig.anteilGut && r.proWoche >= konfig.proWoche && bausteineOffen.length === 0;
    return r;
  }

  /* ---------- Import / Export ---------- */
  function importPaket(obj) {
    const p = RHS.normalize(obj);
    // Personen/Hunde/Teams: Hunde nach Rufname abgleichen, Teams je Sparte ergänzen
    p.hunde.forEach(h => { let l = state.hunde.find(x => x.id === h.id) || state.hunde.find(x => x.rufname.toLowerCase() === (h.rufname || '').toLowerCase()); if (!l) { state.hunde.push({ id: h.id, rufname: h.rufname, geburtsdatum: h.geburtsdatum || '', rasse: h.rasse || '', sparten: h.sparten || [] }); } else { h.sparten && h.sparten.forEach(s => { if (!l.sparten.includes(s)) l.sparten.push(s); }); h._lokalId = l.id; } });
    const personMap = {};
    p.personen.forEach(pp => { let l = state.personen.find(x => x.id === pp.id) || state.personen.find(x => x.name && pp.name && x.name.toLowerCase() === pp.name.toLowerCase()); if (!l) { if (state.personen.length === 1 && !state.personen[0].name) { l = state.personen[0]; l.name = pp.name || ''; } else { l = { id: pp.id, name: pp.name || 'Import', organisation: pp.organisation || '' }; state.personen.push(l); } } personMap[pp.id] = l.id; });
    const teamMap = {};
    p.teams.forEach(t => { const h = p.hunde.find(x => x.id === t.hundId); const hid = h && h._lokalId || t.hundId; const pid = personMap[t.personId] || state.person.id; let l = state.teams.find(x => x.hundId === hid && x.sparte === t.sparte && x.personId === pid); if (!l) { l = { id: t.id, personId: pid, hundId: hid, sparte: t.sparte, status: t.status || 'in_ausbildung', anzeigeart: t.anzeigeart || '' }; state.teams.push(l); } teamMap[t.id] = l.id; });
    // Einträge ohne Team: dem ersten Team passender Sparte zuordnen (oder anlegen)
    p.records.filter(r => r.type === 'entry').forEach(r => { const d = r.data; if (d.teamId && teamMap[d.teamId]) d.teamId = teamMap[d.teamId]; if (!d.teamId || !team(d.teamId)) { let t = state.teams.find(x => x.sparte === d.sparte); if (!t) { if (!state.hunde.length) state.hunde.push({ id: 'h-' + RHS.hilfen.uid().slice(3), rufname: 'Hund', geburtsdatum: '', rasse: '', sparten: [d.sparte] }); t = { id: 'team-' + RHS.hilfen.uid().slice(3), personId: state.person.id, hundId: state.hunde[0].id, sparte: d.sparte, status: 'in_ausbildung', anzeigeart: '' }; state.teams.push(t); } d.teamId = t.id; } });
    (p.orte || []).forEach(o => { if (o.name && !state.orte.some(x => x.name === o.name)) state.orte.push({ name: o.name, lat: o.lat || null, lon: o.lon || null, entfernungKm: o.entfernungKm ?? null, gelaendeart: o.gelaendeart || '' }); });
    const erg = RHS.merge(state.records, { records: p.records.filter(r => r.type === 'entry') });
    state.records = erg.records; speichern(); return Object.assign(erg, { format: RHS.detect(obj) });
  }
  function exportPaket(filter) {
    const es = eintraege().filter(filter || (() => true)).map(clone);
    es.forEach(e => { delete e.data.roh; });
    const hunde = state.hunde.map(h => ({ id: h.id, rufname: h.rufname, geburtsdatum: h.geburtsdatum || null, rasse: h.rasse, sparten: h.sparten }));
    return RHS.buildPackage({ packageType: 'training', source: { app: 'rh-trainingstagebuch', appVersion: '0.1', instanceId: state.person.id },
      personen: state.personen.map(p => ({ id: p.id, name: p.name || 'Hundeführer/-in', rolle: ['hundefuehrer'], organisation: p.organisation || '' })),
      hunde, teams: state.teams.map(t => ({ id: t.id, personId: t.personId, hundId: t.hundId, sparte: t.sparte, status: t.status, anzeigeart: t.anzeigeart })), records: es });
  }
  function dl(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  const heute = () => new Date().toISOString().slice(0, 10);

  /* ---------- UI ---------- */
  async function wetterAbrufen(la, lo) {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + la.toFixed(4) + '&longitude=' + lo.toFixed(4) + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover&wind_speed_unit=kmh&timezone=auto';
    const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).current || {};
  }
  const WMO = { 0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'Reifnebel', 51: 'leichter Niesel', 53: 'Niesel', 55: 'starker Niesel', 61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 71: 'leichter Schnee', 73: 'Schnee', 75: 'starker Schnee', 80: 'Schauer', 81: 'Schauer', 82: 'heftige Schauer', 95: 'Gewitter' };
  function wetterText(c) {
    const rich = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'][Math.round((c.wind_direction_10m || 0) / 45) % 8];
    const nied = c.precipitation > 0 ? (c.weather_code >= 71 && c.weather_code <= 77 ? 'Schnee' : c.precipitation < 0.5 ? 'Nieselregen' : 'Regen') : (c.weather_code === 45 || c.weather_code === 48 ? 'Nebel' : 'trocken');
    return { rich, nied, text: (WMO[c.weather_code] || 'Wetterlage ' + c.weather_code) + ', ' + c.temperature_2m + ' °C, Luftfeuchte ' + c.relative_humidity_2m + ' %, Wind ' + c.wind_speed_10m + ' km/h aus ' + rich + ' (Böen ' + c.wind_gusts_10m + '), Niederschlag ' + c.precipitation + ' mm' };
  }
  function holeWetter() { return new Promise((ok, nein) => { if (!navigator.geolocation) return nein(new Error('kein GPS')); navigator.geolocation.getCurrentPosition(async p => { try { const c = await wetterAbrufen(p.coords.latitude, p.coords.longitude); ok(Object.assign({ c, uhrzeit: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) }, wetterText(c))); } catch (e) { nein(e); } }, () => nein(new Error('Position nicht verfügbar'))); }); }
  let wFilter = '';
  // Teamfortschritt: Mittel der letzten 3 Einheiten gegen die 3 davor
  function fortschritt(teamId) {
    const es = eintraege().filter(e => e.data.teamId === teamId).sort((a, b) => Date.parse(a.data.beginn) - Date.parse(b.data.beginn));
    const reihe = k => es.map(e => e.data.bewertung[k]).filter(v => v != null);
    const vgl = k => { const r = reihe(k); if (r.length < 2) return null; const n = Math.min(3, Math.floor(r.length / 2)); const neu = r.slice(-n), alt = r.slice(-2 * n, -n); const m = a => a.reduce((x, y) => x + y, 0) / a.length; return { jetzt: m(neu), vorher: m(alt), d: m(neu) - m(alt), n: r.length }; };
    const letzte = es[es.length - 1];
    return { hund: vgl('hundeleistung'), fuehrer: vgl('fuehrerleistung'), schwierigkeit: vgl('schwierigkeit'), letzteDelta: letzte ? letzte.data.bewertung.deltaZurVoreinheit : null, anzahl: es.length };
  }
  // Trainingsempfehlung: regelbasiert aus den Einträgen abgeleitet (keine Fachaussage, sondern Hinweis)
  function empfehlungen(teamId) {
    const t = team(teamId); const k = state.einstellungen; const out = [];
    const es = eintraege().filter(e => e.data.teamId === teamId).sort((a, b) => Date.parse(b.data.beginn) - Date.parse(a.data.beginn));
    if (!es.length) return ['Noch keine Einträge – erstes Training erfassen.'];
    const w = wochenSeit(teamId); if (w != null && w >= (k.gelb || 6)) out.push('Seit ' + Math.round(w) + ' Wochen kein Training in ' + SPARTEN[t.sparte].label + ' – zeitnah wieder aufnehmen.');
    const n = es[0].data.bewertung.naechsterSchritt; if (n) out.push('Vorgemerkter nächster Schritt: „' + n + '“.');
    const letzte = es.slice(0, 5); const m = key => { const v = letzte.map(e => e.data.bewertung[key]).filter(x => x != null); return v.length >= 2 ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const sel = m('selbststaendigkeit'), zus = m('zusammenarbeit'), schw = m('schwierigkeit');
    if (sel != null && sel < 3) out.push('Selbstständigkeit zuletzt im Mittel ' + sel.toFixed(1) + ' – Aufgaben mit weniger Hilfen durch den HF einplanen.');
    if (zus != null && zus < 3) out.push('Zusammenarbeit zuletzt im Mittel ' + zus.toFixed(1) + ' – Führ- und Kommunikationsübungen einbauen.');
    const vps = letzte.flatMap(e => (e.data.nutzlast || {}).versteckpersonen || []); const q = vps.map(v => (v.anzeige || {}).qualitaet).filter(x => x);
    if (q.length >= 2 && q.reduce((a, b) => a + b, 0) / q.length < 3) out.push('Anzeigequalität zuletzt unter 3 – gezieltes Anzeigetraining (Sparte Anzeigetraining) einschieben.');
    const gef = vps.filter(v => v.gefunden != null); const quote = gef.length ? gef.filter(v => v.gefunden).length / gef.length : null;
    const bew = letzte.filter(e => e.data.bewertung.ergebnis && e.data.bewertung.ergebnis !== 'offen'); const erf = bew.length ? bew.filter(e => e.data.bewertung.ergebnis === 'erfolgreich').length / bew.length : null;
    if (erf == null && quote == null) out.push('Bei den letzten Einträgen ist kein Ergebnis eingetragen – Ergebnis nachtragen, damit die Auswertung greift.');
    else if ((quote != null && quote < 0.7) || (erf != null && erf < 0.6)) out.push('Erfolgsquote zuletzt ' + Math.round((quote != null ? quote : erf) * 100) + ' % – Schwierigkeit vorübergehend senken.');
    else if (bew.length >= 3 && erf >= 0.9 && (schw == null || schw < 3.5)) out.push('Zuletzt durchgehend erfolgreich' + (schw != null ? ' bei Schwierigkeit ' + schw.toFixed(1) : '') + ' – nächste Steigerungsstufe angehen.');
    const ha = letzte.map(e => (e.data.hundZustand || {}).auffaelligkeiten).filter(x => x && !/^keine/i.test(x)); if (ha.length) out.push('Auffälligkeiten beim Hund vermerkt („' + ha[0] + '“) – Belastung prüfen.');
    if (!out.length) out.push('Keine Auffälligkeiten – Trainingsplan wie vorgesehen fortsetzen.');
    return out;
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(dateien) { // [{name, text}] → Uint8Array (unkomprimiert)
    const enc = new TextEncoder(); const teile = [], zentral = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    dateien.forEach(f => { const n = enc.encode(f.name), d = enc.encode(f.text), c = crc32(d);
      const kopf = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0)];
      teile.push(new Uint8Array(kopf), n, d);
      zentral.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), n);
      off += kopf.length + n.length + d.length; });
    const zl = zentral.reduce((a, b) => a + b.length, 0);
    const ende = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(dateien.length), ...u16(dateien.length), ...u32(zl), ...u32(off), ...u16(0)]);
    const alle = [...teile, ...zentral, ende]; const out = new Uint8Array(alle.reduce((a, b) => a + b.length, 0)); let p = 0; alle.forEach(x => { out.set(x, p); p += x.length; }); return out;
  }
  function xlsx(blaetter) { // [{name, zeilen:[[...]]}]
    const x = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    const spalte = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const blatt = z => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>' + z.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => { const ref = spalte(ci) + (ri + 1); return typeof v === 'number' && isFinite(v) ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + x(v) + '</t></is></c>'; }).join('') + '</row>').join('') + '</sheetData></worksheet>';
    const namen = blaetter.map((b, i) => x(String(b.name).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31)) || 'Blatt' + (i + 1));
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + blaetter.map((b, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + namen.map((n, i) => '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + blaetter.map((b, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (blaetter.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      ...blaetter.map((b, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: blatt(b.zeilen) }))
    ]);
  }
  function excelAuswertung() {
    const es = eintraege().slice().sort((a, b) => Date.parse(a.data.beginn) - Date.parse(b.data.beginn));
    const basisKopf = ['Datum', 'Uhrzeit', 'Hund', 'Hundeführer/-in', 'Sparte', 'Art', 'Ort', 'Dauer (Min.)', 'Ergebnis', 'Schwierigkeit', 'Hundeleistung', 'Führung', 'Selbstständigkeit', 'Zusammenarbeit', 'Δ zur Voreinheit', 'Nächster Schritt', 'Temperatur °C', 'Wind km/h', 'Km', 'Quelle', 'Freitext'];
    const basis = e => { const d = e.data, b = d.bewertung || {}, t = team(d.teamId) || {}; const dt = new Date(d.beginn); return [dt.toLocaleDateString('de-DE'), dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), (hund(t.hundId) || {}).rufname || '', (person(t.personId) || {}).name || '', (SPARTEN[d.sparte] || {}).label || d.sparte, ({ training: 'Training', pruefung: 'Prüfung', einsatz: 'Einsatz', vorfuehrung: 'Vorführung', sonstiges: 'Sonstiges' })[d.typ] || d.typ, (d.ort || {}).name || '', d.ende ? Math.round((Date.parse(d.ende) - Date.parse(d.beginn)) / 6e4) : '', ERG_LABEL[b.ergebnis] || b.ergebnis || '', b.schwierigkeit ?? '', b.hundeleistung ?? '', b.fuehrerleistung ?? '', b.selbststaendigkeit ?? '', b.zusammenarbeit ?? '', b.deltaZurVoreinheit ?? '', b.naechsterSchritt || '', (d.wetter || {}).tempC ?? '', (d.wetter || {}).windKmh ?? '', d.kmHinRueck ?? '', (d.quelle || {}).app || '', b.freitext || '']; };
    const wert = v => Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? '' : v ?? '';
    const blaetter = [{ name: 'Alle Einträge', zeilen: [basisKopf, ...es.map(basis)] }];
    [...new Set(es.map(e => e.data.sparte))].forEach(sp => {
      const cfg = SPARTEN[sp] || SPARTEN.sonstiges; const fl = cfg.felder; const vpk = [...new Set(vpGruppenFuer(cfg).flatMap(g => g.felder))];
      const kopf = [...basisKopf.slice(0, 9), ...fl.map(f => f.l), ...(cfg.skalen || []).map(([, l]) => l), 'Anzeigeart', 'Versteckperson', 'Rolle', 'Gefunden', 'Anzeige', 'Anzeigequalität 1–5', ...vpk.map(k => VP_FELDER[k].l)];
      const zeilen = [kopf];
      es.filter(e => e.data.sparte === sp).forEach(e => { const n = e.data.nutzlast || {}; const b = basis(e).slice(0, 9).concat(fl.map(f => wert(n[f.k])), (cfg.skalen || []).map(([k]) => ((e.data.bewertung.zusatzskalen || []).find(z => z.schluessel === k) || {}).wert ?? ''), [ANZ_LABEL[(n.anzeige || {}).art] || '']);
        const vps = (n.versteckpersonen || []).concat(n.helferDetails || []);
        if (!vps.length) zeilen.push(b); else vps.forEach(v => zeilen.push(b.concat([v.kuerzel || '', v.rolle || '', v.gefundenText || (v.gefunden === true ? 'ja' : v.gefunden === false ? 'nein' : ''), ANZ_LABEL[(v.anzeige || {}).art] || '', (v.anzeige || {}).qualitaet ?? ''], vpk.map(k => wert(v[k]))))); });
      blaetter.push({ name: cfg.label, zeilen });
    });
    const daten = xlsx(blaetter);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([daten], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'Trainingstagebuch_Auswertung_' + new Date().toISOString().slice(0, 10) + '.xlsx'; document.body.appendChild(a); a.click(); a.remove();
    return daten;
  }
  let root = document, bearbeiteId = null, spart = 'flaeche', vps = [], wetterAbruf = null;
  function toast(m) { const t = $('#toast', root); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
  function go(v) { $$('section.view', root).forEach(s => s.classList.toggle('active', s.id === 'v-' + v)); $$('nav.tabs button', root).forEach(b => b.toggleAttribute('aria-current', b.dataset.go === v) || (b.dataset.go === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'))); $('main', root).scrollTop = 0; ({ start: renderStart, tagebuch: renderTagebuch, auswertung: renderAuswertung, team: renderTeam, erfassen: () => { if (!bearbeiteId) neuerEintrag(); } }[v] || (() => { }))(); }

  function feld(f, wert, prefix) {
    const id = prefix + f.k; let v = wert == null ? '' : wert; if (f.t === 'select' && Array.isArray(v)) v = v[0] || '';
    if (f.t === 'chips') return `<div class="f"><span class="hint">${esc(f.l)}</span><div class="chips" data-chips="${id}">${f.o.map(o => `<button type="button" class="chip${(Array.isArray(v) && v.includes(o)) ? ' on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
    if (f.t === 'skala') return `<div class="f"><span class="hint">${esc(f.l)}</span><div class="skala" data-skala="${id}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${v === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>`;
    if (f.t === 'select') return `<label class="f"><span>${esc(f.l)}</span><select id="${id}">${f.o.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.t === 'bool') return `<label class="f" style="display:flex;align-items:center"><input type="checkbox" id="${id}"${v ? ' checked' : ''}> ${esc(f.l)}</label>`;
    if (f.t === 'textarea') return `<label class="f"><span>${esc(f.l)}</span><textarea id="${id}">${esc(v)}</textarea></label>${f.wetterKnopf ? `<button type="button" class="ghost" data-wetterziel="${id}" style="margin:-4px 0 8px">🌐 Wetter jetzt → ${esc(f.l.replace('Wetter beim ', ''))}</button>` : ''}`;
    return `<label class="f"><span>${esc(f.l)}</span><input id="${id}" type="${f.t === 'number' ? 'number' : 'text'}"${f.t === 'number' ? ' inputmode="decimal"' : ''} value="${esc(v)}" placeholder="${esc(f.ph || '')}"></label>`;
  }
  function lesFeld(f, prefix) {
    const id = prefix + f.k;
    if (f.t === 'chips') return $$(`[data-chips="${id}"] .chip.on`, root).map(b => b.dataset.v);
    if (f.t === 'skala') { const b = $(`[data-skala="${id}"] button.on`, root); return b ? Number(b.dataset.v) : null; }
    const el = root.querySelector('#' + id); if (!el) return null;
    if (f.t === 'bool') return el.checked; if (f.t === 'number') return el.value === '' ? null : Number(el.value); return el.value;
  }
  function bindChips(c) {
    $$('[data-chips] .chip', c).forEach(b => b.onclick = () => b.classList.toggle('on'));
    $$('[data-skala] button', c).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  }
  const leerWert = v => v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;
  function renderSpartenFelder(nutzlast) {
    nutzlast = nutzlast || {}; const cfg = SPARTEN[spart]; const c = $('#e-sparte-felder', root);
    let anz = '';
    if (cfg.anzeige) anz = `<label class="f"><span>Anzeigeart</span><select id="sf-anzeigeart">${['', ...cfg.anzeige].map(a => `<option value="${a}"${(nutzlast.anzeige || {}).art === a ? ' selected' : ''}>${a ? esc(ANZ_LABEL[a] || a) : '–'}</option>`).join('')}</select></label>`;
    c.innerHTML = cfg.gruppen.map((g, gi) => { const n = g.felder.filter(f => !leerWert(nutzlast[f.k])).length; return `<details class="card"${n ? ' open' : ''}><summary>${esc(g.titel)} <span class="hint">(${n ? n + ' von ' + g.felder.length + ' ausgefüllt' : 'optional'})</span></summary><div>${gi === 0 ? anz : ''}${g.felder.map(f => feld(f, nutzlast[f.k], 'sf-')).join('')}</div></details>`; }).join('');
    bindChips(c);
    const sk = $('#e-skalen', root);
    sk.innerHTML = SKALEN_STD.concat(cfg.skalen || []).map(([k, l]) => feld({ k, l, t: 'skala' }, null, 'sk-')).join('');
    bindChips(sk); ausfuehrlichAnwenden();
  }
  function renderVps() {
    const cfg = SPARTEN[spart]; const c = $('#e-vps', root); const gruppen = vpGruppenFuer(cfg);
    c.innerHTML = vps.map((vp, i) => `<div class="rep" data-i="${i}">
      <div class="row"><label class="f"><span>Kürzel / Initialen</span><input class="vp-k" maxlength="4" value="${esc(vp.kuerzel)}"></label>
      <label class="f"><span>Rolle</span><select class="vp-r">${cfg.rollen.map(r => `<option${(vp.rolle || cfg.rollen[0]) === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label></div>
      <div class="row"><label class="f"><span>Gefunden / angezeigt</span><select class="vp-g">${GEFUNDEN_OPT.map(o => `<option value="${esc(o)}"${(vp.gefundenText || (vp.gefunden === true ? 'ja, selbstständig' : vp.gefunden === false ? 'überlaufen / nicht gefunden' : '')) === o ? ' selected' : ''}>${o ? esc(o) : '–'}</option>`).join('')}</select></label>
      ${cfg.anzeige ? `<label class="f"><span>Anzeige</span><select class="vp-a">${['', ...cfg.anzeige].map(a => `<option value="${a}"${(vp.anzeige || {}).art === a ? ' selected' : ''}>${a ? esc(ANZ_LABEL[a]) : '–'}</option>`).join('')}</select></label>` : ''}</div>
      ${cfg.anzeige ? `<div class="f"><span class="hint">Anzeigequalität</span><div class="skala" data-skala="vpq${i}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${(vp.anzeige || {}).qualitaet === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>` : ''}
      ${gruppen.map(g => { const n = g.felder.filter(k => !leerWert(vp[k])).length; return `<details class="vpdet"${n ? ' open' : ''}><summary class="hint" style="cursor:pointer">${esc(g.titel)} (${n ? n + ' von ' + g.felder.length + ' ausgefüllt' : g.felder.length + ' Felder, optional'})</summary><div class="row">${g.felder.map(k => feld(Object.assign({ k }, VP_FELDER[k]), vp[k], 'vp' + i + '-')).join('')}</div></details>`; }).join('')}
      <button type="button" class="ghost danger vp-del">Entfernen</button></div>`).join('');
    bindChips(c); ausfuehrlichAnwenden();
    $$('.vp-del', c).forEach(b => b.onclick = () => { lesVps(); vps.splice(Number(b.closest('.rep').dataset.i), 1); renderVps(); });
  }
  function lesVps() {
    const cfg = SPARTEN[spart]; const gruppen = vpGruppenFuer(cfg); const keys = [...new Set(gruppen.flatMap(g => g.felder))];
    vps = $$('#e-vps .rep', root).map((r, i) => {
      const alt = vps[i] || {};
      const vp = Object.assign({}, alt, { kuerzel: RHS.hilfen.kuerzel($('.vp-k', r).value), rolle: $('.vp-r', r).value });
      const g = $('.vp-g', r).value; vp.gefundenText = g; vp.gefunden = g ? /^ja/i.test(g) : undefined;
      if (cfg.anzeige) { const art = $('.vp-a', r).value; const q = $(`[data-skala="vpq${i}"] button.on`, r); vp.anzeige = { art, qualitaet: q ? Number(q.dataset.v) : null, qualitaetText: '', pruefungsberechtigt: cfg.pruefungsberechtigt ? cfg.pruefungsberechtigt.includes(art) : true }; }
      keys.forEach(k => { vp[k] = lesFeld(Object.assign({ k }, VP_FELDER[k]), 'vp' + i + '-'); });
      if (vp.anzeige) vp.anzeige.qualitaetText = vp.anzeigequalitaetText || '';
      return vp;
    });
  }
  function ausfuehrlichAnwenden() { if (state && state.einstellungen.erfassung === 'ausfuehrlich') $$('#v-erfassen details', root).forEach(d => d.open = true); const b = $('#e-umfang', root); if (b) $$('button', b).forEach(x => x.classList.toggle('on', x.dataset.v === (state.einstellungen.erfassung || 'kompakt'))); }
  function neuerEintrag() {
    bearbeiteId = null; vps = [];
    $('#erfassen-titel', root).textContent = 'Training erfassen'; $('#e-delete', root).hidden = true;
    $('#e-hund', root).innerHTML = state.hunde.filter(sichtbarerHund).map(h => `<option value="${h.id}">${esc(h.rufname)}</option>`).join('') || '<option value="">Erst einen Hund anlegen (Reiter Team)</option>';
    $('#e-person', root).innerHTML = state.personen.map(p => `<option value="${p.id}">${esc(p.name || 'Ich')}</option>`).join(''); $('#e-person', root).value = state.person.id; $('#e-person-wrap', root).style.display = state.personen.length > 1 ? '' : 'none';
    $('#e-typ', root).value = 'training'; $('#e-beginn', root).value = toLocalInput(new Date()); $('#e-dauer', root).value = '';
    ['e-ort', 'e-temp', 'e-wind', 'e-km', 'e-ausbilder', 'e-naechster', 'e-freitext', 'e-hv', 'e-hn', 'e-ha'].forEach(id => $('#' + id, root).value = ''); wetterAbruf = null; $('#e-wetter-info', root).textContent = '';
    $('#e-windr', root).value = ''; $('#e-nied', root).value = ''; $('#e-ergebnis', root).value = 'offen';
    const h = hund($('#e-hund', root).value); spart = h && h.sparten[0] && SPARTEN[h.sparten[0]] ? h.sparten[0] : 'flaeche'; renderSpartenWahl(); renderSpartenFelder({}); renderVps();
    $('#ortliste', root).innerHTML = state.orte.map(o => `<option value="${esc(o.name)}">`).join('');
    ausfuehrlichAnwenden();
  }
  function ladeEintrag(id) {
    const e = eintraege().find(x => x.id === id); if (!e) return; neuerEintrag(); bearbeiteId = id; const d = e.data;
    $('#erfassen-titel', root).textContent = 'Eintrag bearbeiten'; $('#e-delete', root).hidden = false;
    $('#e-hund', root).value = (team(d.teamId) || {}).hundId || ''; $('#e-person', root).value = (team(d.teamId) || {}).personId || state.person.id; $('#e-typ', root).value = d.typ; $('#e-beginn', root).value = d.beginn ? toLocalInput(new Date(d.beginn)) : '';
    if (d.ende) $('#e-dauer', root).value = Math.round((Date.parse(d.ende) - Date.parse(d.beginn)) / 6e4);
    $('#e-ort', root).value = (d.ort || {}).name || ''; const w = d.wetter || {}; $('#e-temp', root).value = w.tempC ?? ''; $('#e-wind', root).value = w.windKmh ?? ''; $('#e-windr', root).value = w.windRichtung || ''; $('#e-nied', root).value = w.niederschlag || '';
    $('#e-km', root).value = d.kmHinRueck ?? ''; $('#e-ausbilder', root).value = d.ausbilderKuerzel || '';
    const b = d.bewertung || {}; $('#e-ergebnis', root).value = b.ergebnis || 'offen'; $('#e-naechster', root).value = b.naechsterSchritt || ''; $('#e-freitext', root).value = b.freitext || '';
    const hz = d.hundZustand || {}; $('#e-hv', root).value = hz.vorher || ''; $('#e-hn', root).value = hz.nachher || ''; $('#e-ha', root).value = hz.auffaelligkeiten || '';
    spart = SPARTEN[d.sparte] ? d.sparte : 'sonstiges'; renderSpartenWahl(); renderSpartenFelder(d.nutzlast || {});
    SKALEN_STD.concat(SPARTEN[spart].skalen || []).forEach(([k]) => { const v = b[k] ?? ((b.zusatzskalen || []).find(z => z.schluessel === k) || {}).wert; if (v) { const btn = $(`[data-skala="sk-${k}"] button[data-v="${v}"]`, root); btn && btn.classList.add('on'); } });
    const hd = (d.nutzlast || {}).helferDetails; vps = clone((d.nutzlast || {}).versteckpersonen || []).concat(hd && hd.length ? clone(hd) : clone(d.helfer || []).filter(h => !/spurleger/i.test(h.rolle || '') || !((d.nutzlast || {}).versteckpersonen || []).some(v => v.kuerzel === h.kuerzel)).map(h => Object.assign({ rolle: h.rolle || 'Helfer' }, h))); renderVps();
  }
  function renderSpartenWahl() {
    const c = $('#e-sparten', root); const h = hund($('#e-hund', root).value); const eig = h ? h.sparten : [];
    const alle = Object.keys(SPARTEN).sort((a, b) => (eig.includes(b) - eig.includes(a)));
    c.innerHTML = alle.map(k => `<button type="button" class="${k === spart ? 'on' : ''}" data-s="${k}" style="${eig.includes(k) || k === spart ? '' : 'opacity:.6'}">${esc(SPARTEN[k].label)}</button>`).join('');
    $$('button', c).forEach(b => b.onclick = () => { lesVps(); spart = b.dataset.s; renderSpartenWahl(); renderSpartenFelder({}); renderVps(); });
  }
  function speichernEintrag() {
    const hundId = $('#e-hund', root).value; if (!hundId) { toast('Bitte zuerst einen Hund anlegen'); go('team'); return; }
    lesVps(); const cfg = SPARTEN[spart]; const personId = $('#e-person', root).value || state.person.id; const teamId = teamFuer(personId, hundId, spart, true).id;
    const beginn = new Date($('#e-beginn', root).value); if (isNaN(beginn)) { toast('Beginn fehlt'); return; }
    const dauer = Number($('#e-dauer', root).value); const ende = dauer ? new Date(beginn.getTime() + dauer * 6e4).toISOString() : null;
    const nutzlast = {}; cfg.felder.forEach(f => { const v = lesFeld(f, 'sf-'); if (v !== null && v !== '' && !(Array.isArray(v) && !v.length)) nutzlast[f.k] = v; });
    if (cfg.anzeige) { const art = $('#sf-anzeigeart', root).value; if (art) nutzlast.anzeige = { art, pruefungsberechtigt: cfg.pruefungsberechtigt ? cfg.pruefungsberechtigt.includes(art) : true }; }
    const istHelfer = v => /helfer|ablenkung/i.test(v.rolle || '');
    const helfer = vps.filter(v => istHelfer(v) || /spurleger/i.test(v.rolle || '')).map(v => ({ kuerzel: v.kuerzel, rolle: v.rolle }));
    nutzlast.versteckpersonen = vps.filter(v => !istHelfer(v));
    nutzlast.helferDetails = vps.filter(istHelfer);
    const bew = { ergebnis: $('#e-ergebnis', root).value, naechsterSchritt: $('#e-naechster', root).value, freitext: $('#e-freitext', root).value, zusatzskalen: [] };
    SKALEN_STD.forEach(([k]) => { bew[k] = lesFeld({ k, t: 'skala' }, 'sk-'); });
    (cfg.skalen || []).forEach(([k, l]) => { const v = lesFeld({ k, t: 'skala' }, 'sk-'); if (v) bew.zusatzskalen.push({ schluessel: k, wert: v, beschriftung: l }); });
    const alt = bearbeiteId ? eintraege().find(x => x.id === bearbeiteId) : null;
    const ortName = $('#e-ort', root).value.trim(); const vorlage = state.orte.find(o => o.name === ortName);
    const e = RHS.newEntry({ id: bearbeiteId || undefined, teamId, typ: $('#e-typ', root).value, sparte: spart, beginn: beginn.toISOString(), ende,
      ort: { name: ortName, lat: vorlage ? vorlage.lat : (alt && alt.data.ort || {}).lat || null, lon: vorlage ? vorlage.lon : (alt && alt.data.ort || {}).lon || null, gelaendeart: [].concat(nutzlast.gelaendeart || []).join(', ') },
      wetter: Object.assign({}, alt ? alt.data.wetter : {}, wetterAbruf || {}, { tempC: $('#e-temp', root).value === '' ? null : Number($('#e-temp', root).value), windKmh: $('#e-wind', root).value === '' ? null : Number($('#e-wind', root).value), windRichtung: $('#e-windr', root).value, niederschlag: $('#e-nied', root).value }),
      ausbilderKuerzel: RHS.hilfen.kuerzel($('#e-ausbilder', root).value), helfer, nutzlast: Object.assign({}, alt ? alt.data.nutzlast : {}, nutzlast), bewertung: Object.assign({}, alt ? alt.data.bewertung : {}, bew),
      hundZustand: { vorher: $('#e-hv', root).value, nachher: $('#e-hn', root).value, auffaelligkeiten: $('#e-ha', root).value },
      kmHinRueck: $('#e-km', root).value === '' ? null : Number($('#e-km', root).value),
      quelle: alt ? alt.data.quelle : { app: 'rh-trainingstagebuch', appVersion: '0.1', schemaVersion: RHS.SCHEMA },
      fieldMeta: { revision: alt ? Number((alt.fieldMeta || {}).revision || 0) + 1 : 1, updatedAt: new Date().toISOString() } });
    const vor = eintraege().filter(x => x.id !== e.id && x.data.teamId === teamId && Date.parse(x.data.beginn) < Date.parse(e.data.beginn) && x.data.bewertung.hundeleistung != null).sort((a, b) => Date.parse(b.data.beginn) - Date.parse(a.data.beginn))[0];
    e.data.bewertung.deltaZurVoreinheit = vor && e.data.bewertung.hundeleistung != null ? e.data.bewertung.hundeleistung - vor.data.bewertung.hundeleistung : null;
    if (alt) { e.data.anhaenge = alt.data.anhaenge; e.data.roh = alt.data.roh; state.records[state.records.indexOf(alt)] = e; } else state.records.push(e);
    speichern(); toast(alt ? 'Eintrag aktualisiert' : 'Eintrag gespeichert'); bearbeiteId = null; go('tagebuch');
  }

  function renderStart() {
    $('#startlead', root).textContent = state.teams.length ? (state.person.name ? state.person.name + ', ' : '') + eintraege().length + ' Einträge, ' + state.teams.length + ' Team(s).' : 'Willkommen. Lege zuerst Hund und Team an, dann kannst du Trainings erfassen.';
    $('#startampel', root).innerHTML = state.teams.filter(t => sichtbarerHund(hund(t.hundId) || {})).map(t => { const a = ampel(t.id); const w = wochenSeit(t.id); return `<div class="ampel ${a === 'n' ? '' : a}"><span><span class="dot ${a}"></span>${esc(teamLabel(t))}</span><small>${w == null ? 'noch kein Training' : 'letztes Training vor ' + (w < 1 ? (Math.round(w * 7) === 1 ? '1 Tag' : Math.round(w * 7) + ' Tagen') : (Math.round(w) === 1 ? '1 Woche' : Math.round(w) + ' Wochen'))}</small></div>`; }).join('');
    const es = eintraege().sort((a, b) => Date.parse(b.data.beginn) - Date.parse(a.data.beginn)).slice(0, 5);
    $('#startletzte', root).innerHTML = es.length ? es.map(zeile).join('') : '<div class="empty">Noch keine Einträge.</div>';
    bindZeilen($('#startletzte', root));
  }
  function zeile(e) { const d = e.data; const b = d.bewertung || {}; const cls = b.ergebnis === 'erfolgreich' ? 'g' : b.ergebnis === 'teilweise' ? 'a' : (b.ergebnis === 'nicht_erfolgreich' || b.ergebnis === 'abgebrochen') ? 'r' : 'n'; return `<div class="entry" data-id="${e.id}"><div><b>${esc((SPARTEN[d.sparte] || {}).label || d.sparte)} · ${esc((hund((team(d.teamId) || {}).hundId) || {}).rufname || '')}</b><small>${fmtD(d.beginn)}${d.ort && d.ort.name ? ' · ' + esc(d.ort.name) : ''}${d.typ !== 'training' ? ' · ' + d.typ : ''}${d.quelle && d.quelle.app && d.quelle.app !== 'rh-trainingstagebuch' ? ' · aus ' + esc(d.quelle.app.replace('rh-', '')) : ''}</small></div><div><span class="dot ${cls}"></span>${esc(ERG_LABEL[b.ergebnis] || '')}</div></div>`; }
  function bindZeilen(c) { $$('.entry', c).forEach(z => z.onclick = () => { ladeEintrag(z.dataset.id); go('erfassen'); }); }
  let tFilter = '';
  function renderTagebuch() {
    const sparten = [...new Set(eintraege().map(e => e.data.sparte))];
    $('#t-filter', root).innerHTML = [['', 'Alle'], ...sparten.map(s => [s, (SPARTEN[s] || {}).label || s])].map(([k, l]) => `<button type="button" class="chip${tFilter === k ? ' on' : ''}" data-v="${k}">${esc(l)}</button>`).join('');
    $$('#t-filter .chip', root).forEach(b => b.onclick = () => { tFilter = b.dataset.v; renderTagebuch(); });
    const es = eintraege().filter(e => !tFilter || e.data.sparte === tFilter).sort((a, b) => Date.parse(b.data.beginn) - Date.parse(a.data.beginn));
    $('#t-liste', root).innerHTML = es.length ? es.map(zeile).join('') : '<div class="empty">Keine Einträge. Erfasse ein Training oder lies eine Datei unter „Daten“ ein.</div>';
    bindZeilen($('#t-liste', root));
  }
  function renderAuswertung() {
    const proHund = state.personen.length > 1 ? state.hunde.map(h => { const tids = state.teams.filter(t => t.hundId === h.id).map(t => t.id); const es = eintraege().filter(e => tids.includes(e.data.teamId)); const f = [...new Set(state.teams.filter(t => t.hundId === h.id).map(t => (person(t.personId) || {}).name || '?'))]; return `<p class="hint">${esc(h.rufname)}: ${es.length} Einträge gesamt, geführt von ${esc(f.join(', '))}</p>`; }).join('') : '';
    $('#a-ampel', root).innerHTML = proHund + state.teams.filter(t => sichtbarerHund(hund(t.hundId) || {})).map(t => { const a = ampel(t.id); const r = reife(t.id); return `<div class="ampel ${a === 'n' ? '' : a}"><span><span class="dot ${a}"></span>${esc(teamLabel(t))}</span><small>${r.eintraege} Einträge in 3 Monaten, ${Math.round(r.anteilGut * 100)} % erfolgreich</small></div>`; }).join('') || '<div class="empty">Noch keine Teams.</div>';
    const sparten = [...new Set(eintraege().map(e => e.data.sparte))];
    $('#a-wfilter', root).innerHTML = [['', 'Alle'], ...sparten.map(x => [x, (SPARTEN[x] || {}).label || x])].map(([k, l]) => `<button type="button" class="chip${wFilter === k ? ' on' : ''}" data-v="${k}">${esc(l)}</button>`).join('');
    $$('#a-wfilter .chip', root).forEach(b => b.onclick = () => { wFilter = b.dataset.v; renderAuswertung(); });
    const st = statistik(null, 84, wFilter); const wochen = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i * 7 - ((d.getDay() + 6) % 7)); wochen.push(d.toISOString().slice(0, 10)); }
    const max = Math.max(1, ...wochen.map(w => st.wochen[w] || 0));
    $('#a-wochen', root).innerHTML = wochen.map(w => `<div style="height:${(st.wochen[w] || 0) / max * 100}%" title="${w}: ${st.wochen[w] || 0}"><span>${(wochen.indexOf(w) % 3 === 2) ? w.slice(8, 10) + '.' + w.slice(5, 7) + '.' : ''}</span></div>`).join('');
    $('#a-wochen-txt', root).textContent = st.anzahl + ' Einträge in 12 Wochen, davon ' + st.erfolgreich + ' erfolgreich.';
    const rows = Object.keys(SPARTEN).map(s => { const es = eintraege().filter(e => e.data.sparte === s); if (!es.length) return ''; const g = es.filter(e => e.data.bewertung.ergebnis === 'erfolgreich').length; const q = es.flatMap(e => ((e.data.nutzlast || {}).versteckpersonen || []).map(v => (v.anzeige || {}).qualitaet)).filter(x => x); return `<tr><td>${esc(SPARTEN[s].label)}</td><td>${es.length}</td><td>${Math.round(g / es.length * 100)} %</td><td>${q.length ? (q.reduce((a, b) => a + b, 0) / q.length).toFixed(1) : '–'}</td></tr>`; }).join('');
    $('#a-sparten', root).innerHTML = '<tr><th>Sparte</th><th>Einträge</th><th>erfolgreich</th><th>Ø Anzeige</th></tr>' + (rows || '<tr><td colspan="4" class="hint">noch keine Daten</td></tr>');
    const sichtTeams = state.teams.filter(t => sichtbarerHund(hund(t.hundId) || {}) && eintraege().some(e => e.data.teamId === t.id));
    const pfeil = d => d == null ? '' : d > 0.25 ? ' <span style="color:var(--green)">▲ +' + d.toFixed(1) + '</span>' : d < -0.25 ? ' <span style="color:var(--red)">▼ ' + d.toFixed(1) + '</span>' : ' <span class="hint">► gleich</span>';
    $('#a-fortschritt', root).innerHTML = sichtTeams.map(t => { const f = fortschritt(t.id); const z = (l, v) => v ? `<div>${l}: ${v.jetzt.toFixed(1)}${pfeil(v.d)} <span class="hint">(vorher ${v.vorher.toFixed(1)})</span></div>` : ''; const inhalt = z('Hund', f.hund) + z('Hundeführer/-in', f.fuehrer) + z('Schwierigkeit', f.schwierigkeit); return `<p><b>${esc(teamLabel(t))}</b> <span class="hint">· ${f.anzahl} ${f.anzahl === 1 ? 'Eintrag' : 'Einträge'}${f.letzteDelta != null ? ' · letzte Einheit ' + (f.letzteDelta > 0 ? '+' : '') + f.letzteDelta + ' zur Voreinheit' : ''}</span>${inhalt || '<div class="hint">Für einen Vergleich werden mindestens zwei bewertete Einträge benötigt.</div>'}</p>`; }).join('') || '<div class="empty">Noch keine Einträge.</div>';
    $('#a-empfehlung', root).innerHTML = sichtTeams.map(t => `<p><b>${esc(teamLabel(t))}</b></p><ul style="margin:0 0 10px;padding-left:20px">${empfehlungen(t.id).map(x => '<li>' + esc(x) + '</li>').join('')}</ul>`).join('') + (sichtTeams.length ? '<p class="hint">Automatisch aus den Einträgen abgeleitet (Ampel, letzte fünf Einheiten, vorgemerkter Schritt). Ersetzt nicht die Einschätzung der Ausbilder/-innen.</p>' : '<div class="empty">Noch keine Einträge.</div>');
    $('#a-reife', root).innerHTML = state.teams.map(t => { const r = reife(t.id); return `<p><b>${esc(teamLabel(t))}</b><br>${r.ok ? '<span class="dot g"></span>Bedingungen erfüllt' : '<span class="dot a"></span>noch nicht erfüllt'}: ${r.eintraege} Einträge (${r.proWoche.toFixed(1)} pro Woche, Ziel ≥ 1), ${Math.round(r.anteilGut * 100)} % erfolgreich (Ziel ≥ 80 %).<br><span class="hint">Prüfungsbausteine je Modul werden über die Prüfungsordnung konfiguriert – in dieser Version noch nicht hinterlegt.</span></p>`; }).join('') || '<div class="empty">Noch keine Teams.</div>';
  }
  function renderTeam() {
    if (opts.rahmen === 'barry') { const v = $('#v-team', root); v.innerHTML = '<h2>Personen, Hunde und Teams</h2><p class="lead">In BARRY kommen Personen und Hunde aus der Staffelverwaltung (Verwaltung → Personen / Hunde). Teams je Sparte entstehen automatisch aus Hundeführer/-in und den Sparten des Hundes.</p>' + state.hunde.filter(sichtbarerHund).map(h => `<div class="card"><b>${esc(h.rufname)}</b> <small class="hint">${esc(h.rasse || '')}</small><div class="chips" style="margin-top:6px">${state.teams.filter(t => t.hundId === h.id).map(t => `<span class="chip on">${esc((person(t.personId) || {}).name || '?')} · ${esc(SPARTEN[t.sparte].label)}</span>`).join('')}</div></div>`).join(''); renderTeamchip(); return; }
    $('#personenliste', root).innerHTML = state.personen.map(p => `<div class="entry" style="cursor:default"><div><b>${esc(p.name || 'Ich (ohne Namen)')}</b><small>${esc(p.organisation || '')} · ${state.teams.filter(t => t.personId === p.id).length} Team(s)</small></div>${state.personen.length > 1 ? `<button class="ghost danger" data-pdel="${p.id}">Entfernen</button>` : ''}</div>`).join('');
    $$('[data-pdel]', root).forEach(b => b.onclick = () => { const n = state.teams.filter(t => t.personId === b.dataset.pdel).length; if (confirm('Person und ihre ' + n + ' Team(s) samt Einträgen entfernen?')) { const tids = state.teams.filter(t => t.personId === b.dataset.pdel).map(t => t.id); state.teams = state.teams.filter(t => t.personId !== b.dataset.pdel); state.records = state.records.filter(r => r.type !== 'entry' || !tids.includes(r.data.teamId)); state.personen = state.personen.filter(p => p.id !== b.dataset.pdel); if (!person(state.person.id)) state.person = state.personen[0]; speichern(); renderTeam(); } });
    $('#p-name', root).value = ''; $('#p-org', root).value = '';
    $('#hundeliste', root).innerHTML = state.hunde.map(h => `<div class="card"><b>${esc(h.rufname)}</b> <small class="hint">${esc(h.rasse || '')}${h.geburtsdatum ? ' · geb. ' + esc(h.geburtsdatum) : ''}</small><div class="chips" style="margin-top:6px">${state.teams.filter(t => t.hundId === h.id).map(t => `<span class="chip on">${esc(SPARTEN[t.sparte].label)}</span>`).join('')}</div><div class="btnrow"><button class="ghost" data-add="${h.id}">+ Sparte</button>${state.personen.length > 1 ? `<button class="ghost" data-fuehrer="${h.id}">+ Führer/-in</button>` : ''}<button class="ghost danger" data-del="${h.id}">Hund entfernen</button></div></div>`).join('') || '<div class="empty">Noch kein Hund angelegt.</div>';
    $$('[data-add]', root).forEach(b => b.onclick = () => { const s = prompt('Sparte (' + Object.keys(SPARTEN).join(', ') + '):'); if (s && SPARTEN[s]) { teamFuer(state.person.id, b.dataset.add, s, true); speichern(); renderTeam(); } });
    $$('[data-fuehrer]', root).forEach(b => b.onclick = () => { const namen = state.personen.map((p, i) => (i + 1) + ' = ' + (p.name || 'Ich')).join(', '); const w = prompt('Welche Person führt diesen Hund zusätzlich? ' + namen); const pp = state.personen[Number(w) - 1]; if (pp) { hund(b.dataset.fuehrer).sparten.forEach(s => teamFuer(pp.id, b.dataset.fuehrer, s, true)); speichern(); renderTeam(); toast('Teams angelegt'); } });
    $$('[data-del]', root).forEach(b => b.onclick = () => { const n = eintraege().filter(e => (team(e.data.teamId) || {}).hundId === b.dataset.del).length; if (confirm('Hund und ' + n + ' Einträge löschen?')) { state.teams = state.teams.filter(t => t.hundId !== b.dataset.del); state.records = state.records.filter(e => e.type !== 'entry' || team(e.data.teamId)); state.hunde = state.hunde.filter(h => h.id !== b.dataset.del); speichern(); renderTeam(); } });
    $('#h-sparten', root).innerHTML = ['flaeche', 'truemmer', 'mantrailing', 'gehorsam', 'physio', 'alltag'].map(s => `<button type="button" class="chip" data-v="${s}">${esc(SPARTEN[s].label)}</button>`).join('');
    $$('#h-sparten .chip', root).forEach(b => b.onclick = () => b.classList.toggle('on')); renderTeamchip();
  }
  function renderTeamchip() { const c = $('#teamchip', root); c.textContent = state.hunde.length ? state.hunde.map(h => h.rufname).join(', ') : 'Kein Team'; }
  // Personen-Migration auch für Sicherungen älterer Stände
  document.addEventListener('tagebuch:changed', () => { if (state && !state.personen) migriere(state); });

  function start(o) {
    opts = o || {}; root = opts.root || document.body; if (root === document) root = document.body;
    markupEinsetzen(root, opts.rahmen === 'barry' ? 'barry' : 'standalone');
    state = opts.state ? migriere(opts.state) : laden();
    if (opts.rahmen !== 'barry') document.documentElement.classList.add('tbm-page');
    if (state.einstellungen.theme) document.documentElement.dataset.theme = state.einstellungen.theme;
    $$('[data-go]', root).forEach(b => b.onclick = () => { if (b.dataset.go === 'erfassen' && !bearbeiteId) neuerEintrag(); go(b.dataset.go); });
    $('#e-hund', root).onchange = () => { renderSpartenWahl(); };
    $('#e-save', root).onclick = speichernEintrag;
    $('#e-cancel', root).onclick = () => { bearbeiteId = null; go('tagebuch'); };
    $('#e-delete', root).onclick = () => { if (bearbeiteId && confirm('Eintrag löschen?')) { state.records = state.records.filter(r => r.id !== bearbeiteId); speichern(); bearbeiteId = null; go('tagebuch'); } };
    $('#e-vp-add', root).onclick = () => { lesVps(); vps.push({ kuerzel: '', rolle: spart === 'mantrailing' ? 'Spurleger' : 'Versteckperson' }); renderVps(); };
    $('#e-gps', root).onclick = () => { if (!navigator.geolocation) return toast('Kein GPS verfügbar'); navigator.geolocation.getCurrentPosition(p => { const o = state.orte.find(x => x.name === $('#e-ort', root).value.trim()); if (o) { o.lat = p.coords.latitude; o.lon = p.coords.longitude; speichern(); } $('#e-ort', root).dataset.lat = p.coords.latitude; $('#e-ort', root).dataset.lon = p.coords.longitude; toast('Position übernommen'); }, () => toast('Position nicht verfügbar')); };
    $('#e-ort', root).oninput = () => { const o = state.orte.find(x => x.name === $('#e-ort', root).value.trim()); if (o && o.entfernungKm != null && !$('#e-km', root).value) $('#e-km', root).value = o.entfernungKm * 2; };
    $$('#e-umfang button', root).forEach(b => b.onclick = () => { state.einstellungen.erfassung = b.dataset.v; speichern(); if (b.dataset.v === 'kompakt') $$('#v-erfassen details', root).forEach(d => { const gefuellt = /ausgefüllt/.test(d.querySelector('summary').textContent); if (!gefuellt && !d.hasAttribute('data-immer')) d.open = false; }); ausfuehrlichAnwenden(); });
    $('#e-sparte-felder', root).addEventListener('click', ev => { const b = ev.target.closest('[data-wetterziel]'); if (!b) return; const ziel = root.querySelector('#' + b.dataset.wetterziel); b.disabled = true; b.textContent = 'Wetter wird abgerufen …';
      holeWetter().then(w => { const zeile = w.uhrzeit + ' Uhr: ' + w.text; ziel.value = ziel.value ? ziel.value + '\n' + zeile : zeile; if ($('#e-temp', root).value === '') $('#e-temp', root).value = w.c.temperature_2m; const tb = root.querySelector('#sf-temperaturBoden'); if (tb && !tb.value) tb.value = w.c.temperature_2m + ' °C'; }).catch(e => toast('Wetterabruf nicht möglich: ' + e.message)).finally(() => { b.disabled = false; b.textContent = '🌐 Wetter jetzt → ' + (/Legen/.test(b.dataset.wetterziel) ? 'Legen' : 'Arbeiten'); }); });
    $('#e-wetter', root).onclick = () => {
      if (!navigator.geolocation) return toast('Kein GPS verfügbar');
      const info = $('#e-wetter-info', root); info.textContent = 'Position wird ermittelt …';
      navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude: la, longitude: lo } = pos.coords;
        try {
          const c = await wetterAbrufen(la, lo); const { rich, nied } = wetterText(c);
          if ($('#e-temp', root).value === '') $('#e-temp', root).value = c.temperature_2m; $('#e-wind', root).value = c.wind_speed_10m; $('#e-windr', root).value = rich; $('#e-nied', root).value = nied;
          wetterAbruf = { gefuehltC: c.apparent_temperature, luftfeuchteProzent: c.relative_humidity_2m, boeenKmh: c.wind_gusts_10m, bewoelkungProzent: c.cloud_cover, wetterCode: c.weather_code, windRichtungGrad: c.wind_direction_10m, abgerufenAm: new Date().toISOString(), lat: la, lon: lo, erfassungsart: 'online' };
          info.textContent = 'Abgerufen ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr: ' + c.temperature_2m + ' °C (gefühlt ' + c.apparent_temperature + '), Wind ' + c.wind_speed_10m + ' km/h aus ' + rich + ', Böen ' + c.wind_gusts_10m + ', Luftfeuchte ' + c.relative_humidity_2m + ' %, ' + nied + '. Werte lassen sich von Hand ändern.';
          $('#e-ort', root).dataset.lat = la; $('#e-ort', root).dataset.lon = lo;
        } catch (e) { info.textContent = 'Wetterabruf nicht möglich (' + e.message + ') – bitte von Hand eintragen.'; }
      }, () => { info.textContent = 'Position nicht verfügbar.'; });
    };
    $('#e-wielet', root).onclick = () => {
      const hundId = $('#e-hund', root).value; const letzter = eintraege().filter(e => e.data.sparte === spart && (team(e.data.teamId) || {}).hundId === hundId).sort((a, b) => Date.parse(b.data.beginn) - Date.parse(a.data.beginn))[0];
      if (!letzter) return toast('Noch kein Eintrag dieser Sparte für diesen Hund');
      const d = letzter.data; if (!$('#e-ort', root).value) $('#e-ort', root).value = (d.ort || {}).name || ''; if (!$('#e-km', root).value && d.kmHinRueck != null) $('#e-km', root).value = d.kmHinRueck; if (!$('#e-ausbilder', root).value) $('#e-ausbilder', root).value = d.ausbilderKuerzel || '';
      lesVps(); if (!vps.length) { vps = clone((d.nutzlast || {}).versteckpersonen || []).map(v => ({ kuerzel: v.kuerzel, rolle: v.rolle || 'Versteckperson', versteckart: v.versteckart, hoehe: v.hoehe })).concat(clone(d.helfer || []).map(h => ({ kuerzel: h.kuerzel, rolle: h.rolle || 'Helfer' }))); renderVps(); }
      toast('Ort, Km, Ausbilder und Helfer übernommen');
    };
    $('#e-ortmerken', root).onclick = () => { const n = $('#e-ort', root).value.trim(); if (!n) return; if (!state.orte.some(o => o.name === n)) state.orte.push({ name: n, lat: Number($('#e-ort', root).dataset.lat) || null, lon: Number($('#e-ort', root).dataset.lon) || null }); speichern(); toast('Ort gemerkt'); };
    $('#p-save', root).onclick = () => { const n = $('#p-name', root).value.trim(); if (!n) return toast('Name fehlt'); const org = $('#p-org', root).value.trim(); if (state.personen.length === 1 && !state.personen[0].name) { state.personen[0].name = n; state.personen[0].organisation = org; } else state.personen.push({ id: 'p-' + RHS.hilfen.uid().slice(3), name: n, organisation: org }); speichern(); renderTeam(); toast('Person gespeichert'); };
    $('#h-save', root).onclick = () => { const n = $('#h-name', root).value.trim(); if (!n) return toast('Rufname fehlt'); const sp = $$('#h-sparten .chip.on', root).map(b => b.dataset.v); if (!sp.length) return toast('Mindestens eine Sparte wählen'); const h = { id: 'h-' + RHS.hilfen.uid().slice(3), rufname: n, geburtsdatum: $('#h-geb', root).value, rasse: $('#h-rasse', root).value, sparten: sp }; state.hunde.push(h); sp.forEach(s => teamFuer(state.person.id, h.id, s, true)); $('#h-name', root).value = ''; speichern(); renderTeam(); toast(sp.length + ' Team(s) angelegt'); };
    $('#d-import', root).onchange = ev => { const files = Array.from(ev.target.files); let out = []; let fehler = false; let rest = files.length; let neuGesamt = 0; files.forEach(f => { const r = new FileReader(); r.onload = () => { try { const o = JSON.parse(r.result); if (o && o.tagebuchSicherung) { state = migriere(o.tagebuchSicherung); speichern(); out.push('<b>' + esc(f.name) + '</b>Sicherung wiederhergestellt: ' + eintraege().length + ' Einträge'); } else { const e = importPaket(o); neuGesamt += e.neu; out.push('<b>' + esc(f.name) + '</b>Erkannt als ' + esc(e.format) + ' · ' + e.neu + ' neu, ' + e.aktualisiert + ' aktualisiert, ' + e.unveraendert + ' unverändert' + (e.konflikte.length ? ', ' + e.konflikte.length + ' Konflikt(e) – lokale Fassung behalten' : '')); } } catch (err) { fehler = true; out.push('<b>' + esc(f.name) + '</b>Nicht eingelesen: ' + esc(err.message)); } if (--rest === 0) { const c = $('#d-import-erg', root); c.hidden = false; c.className = 'erg' + (fehler ? ' bad' : ''); c.innerHTML = out.join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">') + (neuGesamt ? '<div class="btnrow" style="margin-top:8px"><button class="ghost" data-go="tagebuch">Zum Tagebuch</button></div>' : ''); $$('[data-go]', c).forEach(b => b.onclick = () => go(b.dataset.go)); toast(fehler ? 'Einlesen mit Fehlern' : neuGesamt + ' Einträge eingelesen'); renderTeamchip(); } }; r.readAsText(f); }); ev.target.value = ''; };
    $('#d-backup', root).onclick = () => dl('Tagebuch_Sicherung_' + heute() + '.json', JSON.stringify({ tagebuchSicherung: state, erzeugtAm: new Date().toISOString() }, null, 2), 'application/json');
    $('#d-v3', root).onclick = async () => { const p = exportPaket(); p.pruefsumme = await RHS.checksum(p.records); dl('RHS_Tagebuch_v3_' + heute() + '.json', JSON.stringify(p, null, 2), 'application/json'); };
    $('#d-csv', root).onclick = () => dl('Tagebuch_' + heute() + '.csv', '\ufeff' + RHS.toCsv(eintraege()), 'text/csv');
    $('#d-gpx', root).onclick = () => { const mit = eintraege().filter(e => { const n = e.data.nutzlast || {}; return (n.trackHund || []).length || (n.trackFuehrer || []).length || (n.trackSpurleger || []).length; }); if (!mit.length) return toast('Keine Tracks vorhanden'); mit.forEach(e => dl('Track_' + e.data.sparte + '_' + String(e.data.beginn).slice(0, 10) + '.gpx', RHS.toGpx(e), 'application/gpx+xml')); };
    $('#d-print', root).onclick = () => window.print();
    $('#a-xlsx', root).onclick = () => { if (!eintraege().length) return toast('Noch keine Einträge'); excelAuswertung(); toast('Excel-Datei erzeugt'); };
    $('#d-theme', root).value = state.einstellungen.theme || ''; $('#d-theme', root).onchange = () => { state.einstellungen.theme = $('#d-theme', root).value; if (state.einstellungen.theme) document.documentElement.dataset.theme = state.einstellungen.theme; else delete document.documentElement.dataset.theme; speichern(); };
    $('#d-gelb', root).value = state.einstellungen.gelb; $('#d-rot', root).value = state.einstellungen.rot;
    $('#d-gelb', root).onchange = () => { state.einstellungen.gelb = Number($('#d-gelb', root).value) || 6; speichern(); }; $('#d-rot', root).onchange = () => { state.einstellungen.rot = Number($('#d-rot', root).value) || 12; speichern(); };
    $('#d-reset', root).onclick = () => { if (confirm('Wirklich alle Daten löschen? Vorher sichern!')) { state = leer(); speichern(); renderTeam(); go('start'); } };
    $('#teamchip', root).onclick = () => go('team');
    renderTeamchip(); go('start');
    if (opts.rahmen !== 'barry' && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  win.TagebuchModul = { excelAuswertung, empfehlungen, fortschritt, start, import: importPaket, exportPaket, reife, statistik, ampel, go, get state() { return state; }, SPARTEN, VP_FELDER, leer, migriere };
})(window);
