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
    flaeche: { label: 'Fläche', anzeige: ['verbeller', 'bringsel', 'freiverweiser', 'rueckverweiser'], felder: [
      { k: 'gebietGroesse', l: 'Größe Suchgebiet', t: 'text', ph: 'z. B. 15 ha' },
      { k: 'laufschema', l: 'Laufschema', t: 'select', o: ['', 'Schleife', 'Zickzack', 'Kamm', 'Quadrantenwechsel', 'frei'] },
      { k: 'gelaendeart', l: 'Geländeart', t: 'chips', o: ['Wald', 'Feld/Wiese', 'Böschung', 'Gewässer', 'Ortsrand', 'Gebäude', 'Steinbruch'] },
      { k: 'bewuchsdichte', l: 'Bewuchsdichte', t: 'select', o: ['', 'offen', 'locker', 'dicht', 'sehr dicht'] },
      { k: 'lichtSicht', l: 'Licht / Sicht', t: 'select', o: ['', 'Tag', 'Dämmerung', 'Nacht', 'Nebel'] },
      { k: 'bodenwind', l: 'Bodenwind beobachtet', t: 'text', ph: 'Richtung, Verhalten' },
      { k: 'stoerungen', l: 'Störungen', t: 'chips', o: ['Wild', 'Spaziergänger', 'Fremdhunde', 'Lärm', 'Verkehr'] },
      { k: 'sichtkontaktHFHund', l: 'Sichtkontakt HF–Hund', t: 'select', o: ['', 'durchgehend', 'überwiegend', 'zeitweise', 'selten'] },
      { k: 'fuehrbarkeit', l: 'Führbarkeit im Gelände', t: 'skala' },
      { k: 'verlaufDerSuche', l: 'Verlauf der Suche / Suchqualität', t: 'textarea' },
      { k: 'suchdauerMin', l: 'Reine Suchdauer (Min.)', t: 'number' }
    ], vp: ['versteckart', 'hoehe', 'alterMin', 'sichtbar', 'zeitBisFundMin', 'latenzSek', 'haltevermoegenSek', 'distanzHFHundM', 'fehlverhalten'] },
    truemmer: { label: 'Trümmer', anzeige: ['verbeller', 'sitzen_fundstelle'], pruefungsberechtigt: ['verbeller'], felder: [
      { k: 'truemmerart', l: 'Trümmerart', t: 'chips', o: ['Beton', 'Mauerwerk', 'Holz', 'Mischtrümmer', 'Übungsanlage', 'Abrissobjekt'] },
      { k: 'sicherheit', l: 'Sicherheit vor der Suche', t: 'chips', o: ['Freigabe eingeholt', 'Tabuzonen markiert', 'Rückzugsweg festgelegt', 'Funkprobe', 'PSA angelegt', 'Hund gecheckt', 'Abbruchsignal vereinbart'] },
      { k: 'gefahren', l: 'Gefahren', t: 'chips', o: ['Statik / lose Teile', 'Gas / Chemie', 'Strom', 'Wasser', 'Feuer / Hitze', 'Absturz', 'Staub', 'Maschinen', 'scharfe Kanten'] },
      { k: 'suchphase', l: 'Suchphase', t: 'chips', o: ['Grobsuche', 'Nahsuche', 'Feinsuche / Mikrolokalisierung', 'Distanzsuche', 'Randbereiche'] },
      { k: 'bewegungssicherheit', l: 'Bewegungssicherheit des Hundes', t: 'skala' },
      { k: 'zugaenge', l: 'Zugänge / sichere Wege / Tabuzonen', t: 'text' },
      { k: 'gehorsamsteil', l: 'Trümmer-Gehorsam mitgeübt', t: 'bool' },
      { k: 'ruhephasenMin', l: 'Ruhephasen Hund gesamt (Min.)', t: 'number' }
    ], vp: ['verschuettungTiefe', 'hohlraum', 'geruchsaustritt', 'alterMin', 'zeitBisFundMin', 'latenzSek', 'haltevermoegenSek', 'fehlverhalten'] },
    mantrailing: { label: 'Mantrailing', anzeige: ['anspringen', 'anstupsen', 'sitz_platz', 'verbellen'], felder: [
      { k: 'trailart', l: 'Trailart', t: 'chips', o: ['Hot Trail', 'Cold Trail', 'Fire Trail', 'Drop Trail', 'Blind', 'Double-blind', 'Negativ-Trail'] },
      { k: 'trailAlterMin', l: 'Trailalter (Min.)', t: 'number' },
      { k: 'trailLaengeM', l: 'Traillänge (m)', t: 'number' },
      { k: 'geruchstraeger', l: 'Geruchsartikel', t: 'chips', o: ['Kleidung', 'Gaze', 'Gegenstand', 'Fahrzeugsitz', 'Türklinke'] },
      { k: 'ansatzart', l: 'Ansatzart', t: 'select', o: ['', 'Startpunkt bekannt', 'Startpunkt unbekannt (PLS)', 'Fahrzeugstart', 'Wiederansatz'] },
      { k: 'ansatzbereich', l: 'Art / Größe des Ansatzbereichs, mögliche Abgänge', t: 'text' },
      { k: 'untergrund', l: 'Untergrund', t: 'chips', o: ['Asphalt', 'Wiese', 'Wald', 'Innenstadt', 'Wohngebiet', 'Gebäude', 'Gewerbe'] },
      { k: 'verleitungen', l: 'Verleitungen', t: 'chips', o: ['Fußgänger', 'Fahrräder', 'Fahrzeuge', 'ÖPNV', 'Hunde / Tiere', 'Gebäude', 'Menschenmenge', 'Alt-/Fremdspur'] },
      { k: 'startverhalten', l: 'Startverhalten / Ansatz', t: 'text' },
      { k: 'entscheidungspunkte', l: 'Entscheidungspunkte / Hund lesen', t: 'textarea' },
      { k: 'entscheidungssicherheit', l: 'Entscheidungssicherheit', t: 'skala' },
      { k: 'personendifferenzierung', l: 'Personendifferenzierung', t: 'select', o: ['', 'nicht geübt', 'unsicher', 'mit Hilfe', 'sicher', 'sehr sicher'] },
      { k: 'endpool', l: 'Endpool / Auffindesituation', t: 'textarea' },
      { k: 'abweichungMaxM', l: 'Größte Abweichung vom Trail (m)', t: 'number' }
    ], vp: ['rolle', 'bekanntFuerHund', 'zeitBisFundMin', 'fehlverhalten'], skalen: [['finderwille', 'Finderwille'], ['konzentration', 'Konzentration'], ['belastung', 'Belastbarkeit'], ['handlingHF', 'Handling Hundeführer/-in']] },
    gehorsam: { label: 'Gehorsam', felder: [
      { k: 'uebungen', l: 'Übungen', t: 'chips', o: ['Fuß', 'Sitz', 'Platz', 'Bleib', 'Abruf', 'Ablegen unter Ablenkung', 'Voraus', 'Apport', 'Steg', 'Leiter', 'Wippe', 'Tunnel', 'Tragen', 'Abbruch'] },
      { k: 'ablenkung', l: 'Ablenkung', t: 'select', o: ['', 'keine', 'gering', 'mittel', 'hoch'] },
      { k: 'pruefungsbezug', l: 'Prüfungsbezug', t: 'text', ph: 'z. B. Modul 2 Teil B' }
    ] },
    anzeigeverhalten: { label: 'Anzeigetraining', felder: [
      { k: 'aufbau', l: 'Aufbauschritt', t: 'select', o: ['', 'Motivation', 'Anzeige an sichtbarer Person', 'Anzeige verdeckt', 'Haltevermögen', 'Distanz', 'Ablenkung', 'Fremdperson'] },
      { k: 'ablenkungen', l: 'Ablenkungen während der Anzeige', t: 'chips', o: ['Helfer', 'Geräusche', 'Futter', 'Fremdhund', 'Bewegung'] },
      { k: 'wiederholungen', l: 'Wiederholungen', t: 'number' }
    ], vp: ['sichtbar', 'latenzSek', 'haltevermoegenSek', 'fehlverhalten'] },
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
    rolle: { l: 'Rolle', t: 'select', o: ['Versteckperson', 'Spurleger', 'Helfer', 'Ablenkung'] },
    versteckart: { l: 'Versteckart / Position', t: 'text' }, hoehe: { l: 'Höhe', t: 'select', o: ['', 'liegend', 'sitzend', 'stehend', 'erhöht', 'Baum'] },
    sichtbar: { l: 'Sichtbar für den Hund', t: 'select', o: ['', 'ja', 'teilweise', 'nein'] },
    verschuettungTiefe: { l: 'Verschüttung / Tiefe', t: 'text' }, hohlraum: { l: 'Hohlraumsituation', t: 'text' },
    geruchsaustritt: { l: 'Geruchsaustritt', t: 'chips', o: ['direkt über VP', 'durch Hohlraum', 'durch Spalt/Fuge', 'durch Wind verlagert', 'thermisch', 'über Schacht/Rohr', 'mehrere Austritte', 'unklar'] },
    bekanntFuerHund: { l: 'Dem Hund bekannt', t: 'select', o: ['', 'ja', 'nein'] },
    alterMin: { l: 'Alter der Fährte / Zeit im Versteck (Min.)', t: 'number' },
    zeitBisFundMin: { l: 'Zeit bis Fund (Min.)', t: 'number' }, latenzSek: { l: 'Latenz Auffinden → Anzeige (Sek.)', t: 'number' },
    haltevermoegenSek: { l: 'Haltevermögen / Anzeigedauer (Sek.)', t: 'number' }, distanzHFHundM: { l: 'Distanz HF–Hund bei Anzeigebeginn (m)', t: 'number' },
    fehlverhalten: { l: 'Fehlverhalten bei der Anzeige', t: 'text' }
  };
  const ANZ_LABEL = { verbeller: 'Verbeller', bringsel: 'Bringsel', freiverweiser: 'Freiverweiser', rueckverweiser: 'Rückverweiser', anspringen: 'Anspringen', anstupsen: 'Anstupsen', sitz_platz: 'Sitz/Platz bei Person', verbellen: 'Verbellen', sitzen_fundstelle: 'Sitzen an Fundstelle (nicht prüfungsberechtigt)' };
  const ERG_LABEL = { offen: 'offen', erfolgreich: 'erfolgreich', teilweise: 'teilweise', nicht_erfolgreich: 'nicht erfolgreich', abgebrochen: 'abgebrochen' };

  /* ---------- Zustand ---------- */
  let state, opts = {};
  function leer() { const p = { id: 'p-' + RHS.hilfen.uid().slice(3), name: '', organisation: '' }; return { version: 2, person: p, personen: [p], hunde: [], teams: [], records: [], orte: [], heimatpunkt: null, einstellungen: { gelb: 6, rot: 12, theme: '' } }; }
  function migriere(s) { if (!s.personen) s.personen = [s.person]; if (!s.person) s.person = s.personen[0]; s.version = 2; return s; }
  function laden() { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.version) return migriere(s); } catch (e) { } return leer(); }
  const person = id => state.personen.find(p => p.id === id);
  function speichern() { try { localStorage.setItem(KEY, JSON.stringify(state)); idbMirror(); } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message); } if (opts.onChange) opts.onChange(state); document.dispatchEvent(new CustomEvent('tagebuch:changed')); }
  function idbMirror() { try { const r = indexedDB.open('rhs-tagebuch', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ t: Date.now(), state }, 'state'); }; } catch (e) { } }
  const eintraege = () => state.records.filter(r => r.type === 'entry');
  const team = id => state.teams.find(t => t.id === id);
  const hund = id => state.hunde.find(h => h.id === id);
  const teamLabel = t => { if (!t) return '–'; const mehrere = state.personen.length > 1; return (hund(t.hundId) || {}).rufname + (mehrere ? ' (' + ((person(t.personId) || {}).name || '?') + ')' : '') + ' · ' + (SPARTEN[t.sparte] || {}).label; };
  function teamFuer(personId, hundId, sparte, anlegen) { let t = state.teams.find(x => x.hundId === hundId && x.sparte === sparte && x.personId === personId); if (!t && anlegen) { t = { id: 'team-' + RHS.hilfen.uid().slice(3), personId, hundId, sparte, status: 'in_ausbildung', anzeigeart: '' }; state.teams.push(t); const h = hund(hundId); if (h && !h.sparten.includes(sparte)) h.sparten.push(sparte); } return t; }

  /* ---------- Auswertung ---------- */
  function wochenSeit(teamId) { const es = eintraege().filter(e => e.data.teamId === teamId && e.data.typ !== 'einsatz'); if (!es.length) return null; const last = Math.max(...es.map(e => Date.parse(e.data.beginn))); return (Date.now() - last) / 6048e5; }
  function ampel(teamId) { const w = wochenSeit(teamId); if (w == null) return 'n'; const k = state.einstellungen; return w >= (k.rot || 12) ? 'r' : w >= (k.gelb || 6) ? 'a' : 'g'; }
  function statistik(teamId, tage) {
    const seit = Date.now() - (tage || 365) * 864e5;
    const es = eintraege().filter(e => (!teamId || e.data.teamId === teamId) && Date.parse(e.data.beginn) >= seit);
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
  let root = document, bearbeiteId = null, spart = 'flaeche', vps = [];
  function toast(m) { const t = $('#toast', root); if (!t) return; t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); }
  function go(v) { $$('section.view', root).forEach(s => s.classList.toggle('active', s.id === 'v-' + v)); $$('nav.tabs button', root).forEach(b => b.toggleAttribute('aria-current', b.dataset.go === v) || (b.dataset.go === v ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'))); $('main', root).scrollTop = 0; ({ start: renderStart, tagebuch: renderTagebuch, auswertung: renderAuswertung, team: renderTeam, erfassen: () => { if (!bearbeiteId) neuerEintrag(); } }[v] || (() => { }))(); }

  function feld(f, wert, prefix) {
    const id = prefix + f.k, v = wert == null ? '' : wert;
    if (f.t === 'chips') return `<div class="f"><span class="hint">${esc(f.l)}</span><div class="chips" data-chips="${id}">${f.o.map(o => `<button type="button" class="chip${(Array.isArray(v) && v.includes(o)) ? ' on' : ''}" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>`;
    if (f.t === 'skala') return `<div class="f"><span class="hint">${esc(f.l)}</span><div class="skala" data-skala="${id}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${v === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div>`;
    if (f.t === 'select') return `<label class="f"><span>${esc(f.l)}</span><select id="${id}">${f.o.map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
    if (f.t === 'bool') return `<label class="f" style="display:flex;align-items:center"><input type="checkbox" id="${id}"${v ? ' checked' : ''}> ${esc(f.l)}</label>`;
    if (f.t === 'textarea') return `<label class="f"><span>${esc(f.l)}</span><textarea id="${id}">${esc(v)}</textarea></label>`;
    return `<label class="f"><span>${esc(f.l)}</span><input id="${id}" type="${f.t === 'number' ? 'number' : 'text'}"${f.t === 'number' ? ' inputmode="decimal"' : ''} value="${esc(v)}" placeholder="${esc(f.ph || '')}"></label>`;
  }
  function lesFeld(f, prefix) {
    const id = prefix + f.k;
    if (f.t === 'chips') return $$(`[data-chips="${id}"] .chip.on`, root).map(b => b.dataset.v);
    if (f.t === 'skala') { const b = $(`[data-skala="${id}"] button.on`, root); return b ? Number(b.dataset.v) : null; }
    const el = document.getElementById(id); if (!el) return null;
    if (f.t === 'bool') return el.checked; if (f.t === 'number') return el.value === '' ? null : Number(el.value); return el.value;
  }
  function bindChips(c) {
    $$('[data-chips] .chip', c).forEach(b => b.onclick = () => b.classList.toggle('on'));
    $$('[data-skala] button', c).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  }
  function renderSpartenFelder(nutzlast) {
    nutzlast = nutzlast || {}; const cfg = SPARTEN[spart]; const c = $('#e-sparte-felder', root);
    let anz = '';
    if (cfg.anzeige) anz = `<label class="f"><span>Anzeigeart</span><select id="sf-anzeigeart">${['', ...cfg.anzeige].map(a => `<option value="${a}"${(nutzlast.anzeige || {}).art === a ? ' selected' : ''}>${a ? esc(ANZ_LABEL[a] || a) : '–'}</option>`).join('')}</select></label>`;
    c.innerHTML = `<details class="card" open><summary>${esc(cfg.label)}</summary><div>${anz}${cfg.felder.map(f => feld(f, nutzlast[f.k], 'sf-')).join('')}</div></details>`;
    bindChips(c);
    const sk = $('#e-skalen', root);
    sk.innerHTML = SKALEN_STD.concat(cfg.skalen || []).map(([k, l]) => feld({ k, l, t: 'skala' }, null, 'sk-')).join('');
    bindChips(sk);
  }
  function renderVps() {
    const cfg = SPARTEN[spart]; const c = $('#e-vps', root);
    c.innerHTML = vps.map((vp, i) => `<div class="rep" data-i="${i}">
      <div class="row"><label class="f"><span>Kürzel</span><input class="vp-k" maxlength="4" value="${esc(vp.kuerzel)}"></label>
      <label class="f"><span>Gefunden / angezeigt</span><select class="vp-g"><option value="">–</option><option value="ja"${vp.gefunden === true ? ' selected' : ''}>ja</option><option value="nein"${vp.gefunden === false ? ' selected' : ''}>nein</option></select></label></div>
      ${cfg.anzeige ? `<div class="row"><label class="f"><span>Anzeige</span><select class="vp-a">${['', ...cfg.anzeige].map(a => `<option value="${a}"${(vp.anzeige || {}).art === a ? ' selected' : ''}>${a ? esc(ANZ_LABEL[a]) : '–'}</option>`).join('')}</select></label><div class="f"><span class="hint">Anzeigequalität</span><div class="skala" data-skala="vpq${i}">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="${(vp.anzeige || {}).qualitaet === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div></div></div>` : ''}
      ${(cfg.vp || []).map(k => feld(Object.assign({ k }, VP_FELDER[k]), vp[k], 'vp' + i + '-')).join('')}
      <button type="button" class="ghost danger vp-del">Entfernen</button></div>`).join('');
    bindChips(c);
    $$('.vp-del', c).forEach(b => b.onclick = () => { lesVps(); vps.splice(Number(b.closest('.rep').dataset.i), 1); renderVps(); });
  }
  function lesVps() {
    const cfg = SPARTEN[spart];
    vps = $$('#e-vps .rep', root).map((r, i) => {
      const vp = { kuerzel: RHS.hilfen.kuerzel($('.vp-k', r).value) };
      const g = $('.vp-g', r).value; vp.gefunden = g === 'ja' ? true : g === 'nein' ? false : undefined;
      if (cfg.anzeige) { const art = $('.vp-a', r).value; const q = $(`[data-skala="vpq${i}"] button.on`, r); vp.anzeige = { art, qualitaet: q ? Number(q.dataset.v) : null, pruefungsberechtigt: cfg.pruefungsberechtigt ? cfg.pruefungsberechtigt.includes(art) : true }; }
      (cfg.vp || []).forEach(k => { vp[k] = lesFeld(Object.assign({ k }, VP_FELDER[k]), 'vp' + i + '-'); });
      return vp;
    });
  }
  function neuerEintrag() {
    bearbeiteId = null; vps = [];
    $('#erfassen-titel', root).textContent = 'Training erfassen'; $('#e-delete', root).hidden = true;
    $('#e-hund', root).innerHTML = state.hunde.map(h => `<option value="${h.id}">${esc(h.rufname)}</option>`).join('') || '<option value="">Erst einen Hund anlegen (Reiter Team)</option>';
    $('#e-person', root).innerHTML = state.personen.map(p => `<option value="${p.id}">${esc(p.name || 'Ich')}</option>`).join(''); $('#e-person-wrap', root).style.display = state.personen.length > 1 ? '' : 'none';
    $('#e-typ', root).value = 'training'; $('#e-beginn', root).value = toLocalInput(new Date()); $('#e-dauer', root).value = '';
    ['e-ort', 'e-temp', 'e-wind', 'e-km', 'e-ausbilder', 'e-naechster', 'e-freitext', 'e-hv', 'e-hn', 'e-ha'].forEach(id => $('#' + id, root).value = '');
    $('#e-windr', root).value = ''; $('#e-nied', root).value = ''; $('#e-ergebnis', root).value = 'offen';
    const h = hund($('#e-hund', root).value); spart = h && h.sparten[0] && SPARTEN[h.sparten[0]] ? h.sparten[0] : 'flaeche'; renderSpartenWahl(); renderSpartenFelder({}); renderVps();
    $('#ortliste', root).innerHTML = state.orte.map(o => `<option value="${esc(o.name)}">`).join('');
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
    vps = clone((d.nutzlast || {}).versteckpersonen || []).concat(clone(d.helfer || []).map(h => Object.assign({ rolle: h.rolle || 'Helfer' }, h))); renderVps();
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
    const helfer = vps.filter(v => /helfer|ablenkung|spurleger/i.test(v.rolle || '')).map(v => ({ kuerzel: v.kuerzel, rolle: v.rolle }));
    nutzlast.versteckpersonen = vps.filter(v => !/helfer|ablenkung/i.test(v.rolle || ''));
    const bew = { ergebnis: $('#e-ergebnis', root).value, naechsterSchritt: $('#e-naechster', root).value, freitext: $('#e-freitext', root).value, zusatzskalen: [] };
    SKALEN_STD.forEach(([k]) => { bew[k] = lesFeld({ k, t: 'skala' }, 'sk-'); });
    (cfg.skalen || []).forEach(([k, l]) => { const v = lesFeld({ k, t: 'skala' }, 'sk-'); if (v) bew.zusatzskalen.push({ schluessel: k, wert: v, beschriftung: l }); });
    const alt = bearbeiteId ? eintraege().find(x => x.id === bearbeiteId) : null;
    const ortName = $('#e-ort', root).value.trim(); const vorlage = state.orte.find(o => o.name === ortName);
    const e = RHS.newEntry({ id: bearbeiteId || undefined, teamId, typ: $('#e-typ', root).value, sparte: spart, beginn: beginn.toISOString(), ende,
      ort: { name: ortName, lat: vorlage ? vorlage.lat : (alt && alt.data.ort || {}).lat || null, lon: vorlage ? vorlage.lon : (alt && alt.data.ort || {}).lon || null, gelaendeart: (nutzlast.gelaendeart || []).join(', ') },
      wetter: { tempC: $('#e-temp', root).value === '' ? null : Number($('#e-temp', root).value), windKmh: $('#e-wind', root).value === '' ? null : Number($('#e-wind', root).value), windRichtung: $('#e-windr', root).value, niederschlag: $('#e-nied', root).value },
      ausbilderKuerzel: RHS.hilfen.kuerzel($('#e-ausbilder', root).value), helfer, nutzlast: Object.assign({}, alt ? alt.data.nutzlast : {}, nutzlast), bewertung: Object.assign({}, alt ? alt.data.bewertung : {}, bew),
      hundZustand: { vorher: $('#e-hv', root).value, nachher: $('#e-hn', root).value, auffaelligkeiten: $('#e-ha', root).value },
      kmHinRueck: $('#e-km', root).value === '' ? null : Number($('#e-km', root).value),
      quelle: alt ? alt.data.quelle : { app: 'rh-trainingstagebuch', appVersion: '0.1', schemaVersion: RHS.SCHEMA },
      fieldMeta: { revision: alt ? Number((alt.fieldMeta || {}).revision || 0) + 1 : 1, updatedAt: new Date().toISOString() } });
    if (alt) { e.data.anhaenge = alt.data.anhaenge; e.data.roh = alt.data.roh; state.records[state.records.indexOf(alt)] = e; } else state.records.push(e);
    speichern(); toast(alt ? 'Eintrag aktualisiert' : 'Eintrag gespeichert'); bearbeiteId = null; go('tagebuch');
  }

  function renderStart() {
    $('#startlead', root).textContent = state.teams.length ? (state.person.name ? state.person.name + ', ' : '') + eintraege().length + ' Einträge, ' + state.teams.length + ' Team(s).' : 'Willkommen. Lege zuerst Hund und Team an, dann kannst du Trainings erfassen.';
    $('#startampel', root).innerHTML = state.teams.map(t => { const a = ampel(t.id); const w = wochenSeit(t.id); return `<div class="ampel ${a === 'n' ? '' : a}"><span><span class="dot ${a}"></span>${esc(teamLabel(t))}</span><small>${w == null ? 'noch kein Training' : 'letztes Training vor ' + (w < 1 ? Math.round(w * 7) + ' Tagen' : Math.round(w) + ' Wochen')}</small></div>`; }).join('');
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
    $('#a-ampel', root).innerHTML = proHund + state.teams.map(t => { const a = ampel(t.id); const r = reife(t.id); return `<div class="ampel ${a === 'n' ? '' : a}"><span><span class="dot ${a}"></span>${esc(teamLabel(t))}</span><small>${r.eintraege} Einträge in 3 Monaten, ${Math.round(r.anteilGut * 100)} % erfolgreich</small></div>`; }).join('') || '<div class="empty">Noch keine Teams.</div>';
    const st = statistik(null, 84); const wochen = []; for (let i = 11; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i * 7 - ((d.getDay() + 6) % 7)); wochen.push(d.toISOString().slice(0, 10)); }
    const max = Math.max(1, ...wochen.map(w => st.wochen[w] || 0));
    $('#a-wochen', root).innerHTML = wochen.map(w => `<div style="height:${(st.wochen[w] || 0) / max * 100}%" title="${w}: ${st.wochen[w] || 0}"><span>${(wochen.indexOf(w) % 3 === 2) ? w.slice(8, 10) + '.' + w.slice(5, 7) + '.' : ''}</span></div>`).join('');
    $('#a-wochen-txt', root).textContent = st.anzahl + ' Einträge in 12 Wochen, davon ' + st.erfolgreich + ' erfolgreich.';
    const rows = Object.keys(SPARTEN).map(s => { const es = eintraege().filter(e => e.data.sparte === s); if (!es.length) return ''; const g = es.filter(e => e.data.bewertung.ergebnis === 'erfolgreich').length; const q = es.flatMap(e => ((e.data.nutzlast || {}).versteckpersonen || []).map(v => (v.anzeige || {}).qualitaet)).filter(x => x); return `<tr><td>${esc(SPARTEN[s].label)}</td><td>${es.length}</td><td>${Math.round(g / es.length * 100)} %</td><td>${q.length ? (q.reduce((a, b) => a + b, 0) / q.length).toFixed(1) : '–'}</td></tr>`; }).join('');
    $('#a-sparten', root).innerHTML = '<tr><th>Sparte</th><th>Einträge</th><th>erfolgreich</th><th>Ø Anzeige</th></tr>' + (rows || '<tr><td colspan="4" class="hint">noch keine Daten</td></tr>');
    $('#a-reife', root).innerHTML = state.teams.map(t => { const r = reife(t.id); return `<p><b>${esc(teamLabel(t))}</b><br>${r.ok ? '<span class="dot g"></span>Bedingungen erfüllt' : '<span class="dot a"></span>noch nicht erfüllt'}: ${r.eintraege} Einträge (${r.proWoche.toFixed(1)} pro Woche, Ziel ≥ 1), ${Math.round(r.anteilGut * 100)} % erfolgreich (Ziel ≥ 80 %).<br><span class="hint">Prüfungsbausteine je Modul werden über die Prüfungsordnung konfiguriert – in dieser Version noch nicht hinterlegt.</span></p>`; }).join('') || '<div class="empty">Noch keine Teams.</div>';
  }
  function renderTeam() {
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
    opts = o || {}; root = opts.root || document; state = opts.state || laden();
    if (state.einstellungen.theme) document.documentElement.dataset.theme = state.einstellungen.theme;
    $$('[data-go]', root).forEach(b => b.onclick = () => { if (b.dataset.go === 'erfassen' && !bearbeiteId) neuerEintrag(); go(b.dataset.go); });
    $('#e-hund', root).onchange = () => { renderSpartenWahl(); };
    $('#e-save', root).onclick = speichernEintrag;
    $('#e-cancel', root).onclick = () => { bearbeiteId = null; go('tagebuch'); };
    $('#e-delete', root).onclick = () => { if (bearbeiteId && confirm('Eintrag löschen?')) { state.records = state.records.filter(r => r.id !== bearbeiteId); speichern(); bearbeiteId = null; go('tagebuch'); } };
    $('#e-vp-add', root).onclick = () => { lesVps(); vps.push({ kuerzel: '', rolle: spart === 'mantrailing' ? 'Spurleger' : 'Versteckperson' }); renderVps(); };
    $('#e-gps', root).onclick = () => { if (!navigator.geolocation) return toast('Kein GPS verfügbar'); navigator.geolocation.getCurrentPosition(p => { const o = state.orte.find(x => x.name === $('#e-ort', root).value.trim()); if (o) { o.lat = p.coords.latitude; o.lon = p.coords.longitude; speichern(); } $('#e-ort', root).dataset.lat = p.coords.latitude; $('#e-ort', root).dataset.lon = p.coords.longitude; toast('Position übernommen'); }, () => toast('Position nicht verfügbar')); };
    $('#e-ort', root).oninput = () => { const o = state.orte.find(x => x.name === $('#e-ort', root).value.trim()); if (o && o.entfernungKm != null && !$('#e-km', root).value) $('#e-km', root).value = o.entfernungKm * 2; };
    $('#e-ortmerken', root).onclick = () => { const n = $('#e-ort', root).value.trim(); if (!n) return; if (!state.orte.some(o => o.name === n)) state.orte.push({ name: n, lat: Number($('#e-ort', root).dataset.lat) || null, lon: Number($('#e-ort', root).dataset.lon) || null }); speichern(); toast('Ort gemerkt'); };
    $('#p-save', root).onclick = () => { const n = $('#p-name', root).value.trim(); if (!n) return toast('Name fehlt'); const org = $('#p-org', root).value.trim(); if (state.personen.length === 1 && !state.personen[0].name) { state.personen[0].name = n; state.personen[0].organisation = org; } else state.personen.push({ id: 'p-' + RHS.hilfen.uid().slice(3), name: n, organisation: org }); speichern(); renderTeam(); toast('Person gespeichert'); };
    $('#h-save', root).onclick = () => { const n = $('#h-name', root).value.trim(); if (!n) return toast('Rufname fehlt'); const sp = $$('#h-sparten .chip.on', root).map(b => b.dataset.v); if (!sp.length) return toast('Mindestens eine Sparte wählen'); const h = { id: 'h-' + RHS.hilfen.uid().slice(3), rufname: n, geburtsdatum: $('#h-geb', root).value, rasse: $('#h-rasse', root).value, sparten: sp }; state.hunde.push(h); sp.forEach(s => teamFuer(state.person.id, h.id, s, true)); $('#h-name', root).value = ''; speichern(); renderTeam(); toast(sp.length + ' Team(s) angelegt'); };
    $('#d-import', root).onchange = ev => { const files = Array.from(ev.target.files); let out = []; let fehler = false; let rest = files.length; let neuGesamt = 0; files.forEach(f => { const r = new FileReader(); r.onload = () => { try { const o = JSON.parse(r.result); if (o && o.tagebuchSicherung) { state = migriere(o.tagebuchSicherung); speichern(); out.push('<b>' + esc(f.name) + '</b>Sicherung wiederhergestellt: ' + eintraege().length + ' Einträge'); } else { const e = importPaket(o); neuGesamt += e.neu; out.push('<b>' + esc(f.name) + '</b>Erkannt als ' + esc(e.format) + ' · ' + e.neu + ' neu, ' + e.aktualisiert + ' aktualisiert, ' + e.unveraendert + ' unverändert' + (e.konflikte.length ? ', ' + e.konflikte.length + ' Konflikt(e) – lokale Fassung behalten' : '')); } } catch (err) { fehler = true; out.push('<b>' + esc(f.name) + '</b>Nicht eingelesen: ' + esc(err.message)); } if (--rest === 0) { const c = $('#d-import-erg', root); c.hidden = false; c.className = 'erg' + (fehler ? ' bad' : ''); c.innerHTML = out.join('<hr style="border:0;border-top:1px solid var(--line);margin:8px 0">') + (neuGesamt ? '<div class="btnrow" style="margin-top:8px"><button class="ghost" data-go="tagebuch">Zum Tagebuch</button></div>' : ''); $$('[data-go]', c).forEach(b => b.onclick = () => go(b.dataset.go)); toast(fehler ? 'Einlesen mit Fehlern' : neuGesamt + ' Einträge eingelesen'); renderTeamchip(); } }; r.readAsText(f); }); ev.target.value = ''; };
    $('#d-backup', root).onclick = () => dl('Tagebuch_Sicherung_' + heute() + '.json', JSON.stringify({ tagebuchSicherung: state, erzeugtAm: new Date().toISOString() }, null, 2), 'application/json');
    $('#d-v3', root).onclick = async () => { const p = exportPaket(); p.pruefsumme = await RHS.checksum(p.records); dl('RHS_Tagebuch_v3_' + heute() + '.json', JSON.stringify(p, null, 2), 'application/json'); };
    $('#d-csv', root).onclick = () => dl('Tagebuch_' + heute() + '.csv', '\ufeff' + RHS.toCsv(eintraege()), 'text/csv');
    $('#d-gpx', root).onclick = () => { const mit = eintraege().filter(e => { const n = e.data.nutzlast || {}; return (n.trackHund || []).length || (n.trackFuehrer || []).length || (n.trackSpurleger || []).length; }); if (!mit.length) return toast('Keine Tracks vorhanden'); mit.forEach(e => dl('Track_' + e.data.sparte + '_' + String(e.data.beginn).slice(0, 10) + '.gpx', RHS.toGpx(e), 'application/gpx+xml')); };
    $('#d-print', root).onclick = () => window.print();
    $('#d-theme', root).value = state.einstellungen.theme || ''; $('#d-theme', root).onchange = () => { state.einstellungen.theme = $('#d-theme', root).value; if (state.einstellungen.theme) document.documentElement.dataset.theme = state.einstellungen.theme; else delete document.documentElement.dataset.theme; speichern(); };
    $('#d-gelb', root).value = state.einstellungen.gelb; $('#d-rot', root).value = state.einstellungen.rot;
    $('#d-gelb', root).onchange = () => { state.einstellungen.gelb = Number($('#d-gelb', root).value) || 6; speichern(); }; $('#d-rot', root).onchange = () => { state.einstellungen.rot = Number($('#d-rot', root).value) || 12; speichern(); };
    $('#d-reset', root).onclick = () => { if (confirm('Wirklich alle Daten löschen? Vorher sichern!')) { state = leer(); speichern(); renderTeam(); go('start'); } };
    $('#teamchip', root).onclick = () => go('team');
    renderTeamchip(); go('start');
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
  }

  win.TagebuchModul = { start, import: importPaket, exportPaket, reife, statistik, ampel, get state() { return state; }, SPARTEN, VP_FELDER };
})(window);
