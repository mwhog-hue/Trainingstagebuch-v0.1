/* rhs-exchange.js — gemeinsames Austauschformat der RH-App-Familie, Version 3
 *
 * Läuft im Browser (window.RHS) und in Node (module.exports). Keine Abhängigkeiten.
 *
 * Aufgaben:
 *   RHS.normalize(obj)            -> v3-Paket aus: rhs-exchange v1/v2/v3,
 *                                     rhs-taktik-assistent-export (Fläche),
 *                                     rhs-mantrailing-assistent-export,
 *                                     rhs-truemmersuchassistent-export
 *   RHS.detect(obj)               -> Kennung des Eingabeformats oder null
 *   RHS.validate(pkg)             -> { ok, fehler[] }
 *   RHS.buildPackage(opts)        -> leeres v3-Paket mit Kopf
 *   RHS.newEntry(opts)            -> Eintrag nach Datenmodell (records-Element type 'entry')
 *   RHS.merge(localRecords, pkg)  -> { records, neu, aktualisiert, unveraendert, konflikte[] }
 *   RHS.toGpx(entry)              -> GPX 1.1 (Tracks aus Nutzlast/Anhängen)
 *   RHS.toCsvRows(entries)        -> Zeilen für CSV/Excel
 *   RHS.checksum(records)         -> Promise<string> ("sha256:…"), nur wo SubtleCrypto/Node-crypto
 *
 * Regeln (siehe Dokument "Trainingstagebuch-Datenmodell und RH-Protokoll-Schema"):
 *   - Unbekannte Felder werden nie verworfen: sie landen unter entry.roh bzw. bleiben am Record.
 *   - Versteckpersonen/Spurleger nur als Kürzel; volle Namen werden beim Normalisieren gekürzt.
 *   - Ids bleiben erhalten; gleiche Id = derselbe Datensatz.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RHS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXCHANGE_FORMAT = 'rhs-exchange';
  const SCHEMA = 3;
  const SPARTEN = ['flaeche', 'truemmer', 'mantrailing', 'gehorsam', 'anzeigeverhalten',
    'gewandtheit', 'physio', 'alltag', 'alltagstricks', 'bindung', 'modul11',
    'leiche', 'wasser', 'lawine', 'begleithund', 'igp', 'agility', 'trickdog', 'sonstiges'];
  const TYPEN = ['training', 'pruefung', 'einsatz', 'vorfuehrung', 'sonstiges'];
  const ERGEBNIS = ['erfolgreich', 'teilweise', 'nicht_erfolgreich', 'abgebrochen', 'offen'];
  const ANZEIGEARTEN = {
    flaeche: ['verbeller', 'bringsel', 'freiverweiser', 'rueckverweiser'],
    truemmer: ['verbeller', 'sitzen_fundstelle'],
    mantrailing: ['anspringen', 'anstupsen', 'sitz_platz', 'verbellen']
  };
  // nur Verbeller ist in Trümmern prüfungsberechtigt (Festlegung 30.09.2026)
  const ANZEIGE_PRUEFUNGSBERECHTIGT = { truemmer: ['verbeller'] };

  /* ---------- Hilfen ---------- */
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const nowIso = () => new Date().toISOString();
  const uid = (p) => (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const clone = v => JSON.parse(JSON.stringify(v));
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const str = v => (v == null ? '' : String(v));
  const kuerzel = v => {
    // "Anna Müller" -> "AM", "AM" -> "AM", "" -> ""
    const s = str(v).trim(); if (!s) return '';
    if (/^[A-ZÄÖÜ]{1,4}$/.test(s)) return s;
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return parts.map(p => p[0].toUpperCase()).join('').slice(0, 4);
  };
  const normAnzeige = v => {
    const s = str(v).toLowerCase();
    if (!s) return '';
    if (/verbell|bell/.test(s)) return s.includes('mantr') ? 'verbellen' : 'verbeller';
    if (/bringsel|bringsler/.test(s)) return 'bringsel';
    if (/frei/.test(s)) return 'freiverweiser';
    if (/rück|rueck/.test(s)) return 'rueckverweiser';
    if (/spring/.test(s)) return 'anspringen';
    if (/stups/.test(s)) return 'anstupsen';
    if (/sitz|platz/.test(s)) return s.includes('fund') ? 'sitzen_fundstelle' : 'sitz_platz';
    return s;
  };
  const normSparte = v => {
    const s = str(v).toLowerCase();
    if (/fl[äa]ch/.test(s)) return 'flaeche';
    if (/tr[üu]mm/.test(s)) return 'truemmer';
    if (/mantrail|trail/.test(s)) return 'mantrailing';
    if (/gehorsam|unterordnung/.test(s)) return 'gehorsam';
    if (/anzeige/.test(s)) return 'anzeigeverhalten';
    if (/gewandt|ger[äa]t/.test(s)) return 'gewandtheit';
    if (/physio|fitness/.test(s)) return 'physio';
    if (/tricks/.test(s)) return 'alltagstricks';
    if (/alltag/.test(s)) return 'alltag';
    if (/bindung|kooperation/.test(s)) return 'bindung';
    if (/1\.1|grundfertig/.test(s)) return 'modul11';
    return SPARTEN.includes(s) ? s : (s ? 'sonstiges' : '');
  };
  const trackPoints = (arr) => (Array.isArray(arr) ? arr : []).map(p => {
    if (Array.isArray(p)) return { lat: num(p[0]), lon: num(p[1]), zeit: p[2] || null };
    if (!isObj(p)) return null;
    return { lat: num(p.lat ?? p.latitude), lon: num(p.lon ?? p.lng ?? p.longitude), zeit: p.zeit || p.time || p.t || p.ts || null, hoehe: num(p.ele ?? p.alt ?? p.hoehe) };
  }).filter(p => p && p.lat != null && p.lon != null);

  /* ---------- Kopf / Bausteine ---------- */
  function buildPackage(opts) {
    opts = opts || {};
    return {
      rhsFormat: EXCHANGE_FORMAT,
      schemaVersion: SCHEMA,
      packageType: opts.packageType || 'bundle',   // team | training | einsatz | pruefung | bundle
      packageId: opts.packageId || uid('pkg'),
      createdAt: opts.createdAt || nowIso(),
      source: Object.assign({ app: 'unbekannt', appVersion: '', instanceId: '' }, opts.source || {}),
      personen: opts.personen || [],
      hunde: opts.hunde || [],
      teams: opts.teams || [],
      records: opts.records || []
    };
  }

  function newEntry(o) {
    o = o || {};
    const sparte = normSparte(o.sparte) || 'sonstiges';
    return {
      type: 'entry',
      id: o.id || uid('e'),
      data: {
        teamId: o.teamId || '',
        typ: TYPEN.includes(o.typ) ? o.typ : 'training',
        sparte,
        beginn: o.beginn || nowIso(),
        ende: o.ende || null,
        ort: o.ort || { name: '', lat: null, lon: null, gelaendeart: '' },
        wetter: o.wetter || {},
        ausbilderKuerzel: o.ausbilderKuerzel || '',
        helfer: (o.helfer || []).map(h => typeof h === 'string' ? { kuerzel: kuerzel(h) } : Object.assign({}, h, { kuerzel: kuerzel(h.kuerzel || h.name) , name: undefined })),
        ziel: o.ziel || '',
        nutzlast: o.nutzlast || {},
        bewertung: Object.assign({ ergebnis: 'offen', schwierigkeit: null, hundeleistung: null, fuehrerleistung: null,
          selbststaendigkeit: null, zusammenarbeit: null, zusatzskalen: [], steigerungsstufe: '', naechsterSchritt: '', freitext: '' }, o.bewertung || {}),
        hundZustand: o.hundZustand || { vorher: '', nachher: '', auffaelligkeiten: '' },
        notizen: o.notizen || '',
        anhaenge: o.anhaenge || [],
        kmHinRueck: num(o.kmHinRueck),
        quelle: Object.assign({ app: '', appVersion: '', schemaVersion: SCHEMA, importiertAm: null }, o.quelle || {}),
        roh: o.roh || undefined
      },
      fieldMeta: o.fieldMeta || { revision: 1, updatedAt: nowIso() }
    };
  }

  /* ---------- Erkennung ---------- */
  function detect(obj) {
    if (!isObj(obj)) return null;
    if (obj.rhsFormat === EXCHANGE_FORMAT) return 'rhs-exchange-v' + (Number(obj.schemaVersion) || 1);
    if (obj.bridgeFormat === 'rhs-taktik-assistent-export') return 'flaeche-bridge';
    if (obj.bridgeFormat === 'rhs-mantrailing-assistent-export') return 'mantrailing-bridge';
    if (obj.bridgeFormat === 'rhs-truemmersuchassistent-export') return 'truemmer-bridge';
    return null;
  }

  /* ---------- Normalisierung ---------- */
  function normalize(obj) {
    const kind = detect(obj);
    if (!kind) throw new Error('Kein bekanntes RHS-Format (rhs-exchange v1–3 oder Assistenten-Export).');
    switch (kind) {
      case 'rhs-exchange-v3': return fromV3(obj);
      case 'rhs-exchange-v2': return fromV2(obj);
      case 'rhs-exchange-v1': return fromV1(obj);
      case 'flaeche-bridge': return fromFlaeche(obj);
      case 'mantrailing-bridge': return fromMantrailing(obj);
      case 'truemmer-bridge': return fromTruemmer(obj);
    }
  }

  function fromV3(p) {
    const out = buildPackage({ packageType: p.packageType, packageId: p.packageId, createdAt: p.createdAt, source: p.source,
      personen: p.personen, hunde: p.hunde, teams: p.teams, records: p.records });
    // Kürzel-Regel auch auf fremde v3-Pakete anwenden
    out.records.forEach(r => { if (r.type === 'entry' && r.data) scrubNames(r.data); });
    return out;
  }

  // v2: Team-Stammdaten als records[{type:'team', id, data{handler,dogName,dogBirthDate,dogBreed,disciplines,indicationType}, fieldMeta}]
  function fromV2(p) {
    const out = buildPackage({ packageType: p.packageType || 'team', packageId: p.packageId, createdAt: p.createdAt, source: p.source });
    (p.records || []).forEach(r => {
      if (r.type === 'team') {
        out.records.push(clone(r));                 // unverändert durchreichen (BARRY/Tagebuch lesen das weiter)
        addTeamFromRecord(out, r, p.source);
      } else {
        out.records.push(clone(r));
      }
    });
    return out;
  }

  // v1: payload.team.fields{handler,dog|dogName,geburtsdatum|dogBirthDate,rasseFrei|dogBreed}{value,revision,updatedAt}
  function fromV1(p) {
    const t = p.payload && p.payload.team;
    if (!t) throw new Error('rhs-exchange v1 ohne Team-Stammdaten.');
    const f = t.fields || {};
    const v = (...ks) => { for (const k of ks) if (f[k] && f[k].value !== undefined) return f[k].value; return ''; };
    const mm = (...ks) => { for (const k of ks) if (f[k]) return { revision: Number(f[k].revision || 0), updatedAt: f[k].updatedAt || '' }; return { revision: 0 }; };
    const rec = { type: 'team', id: t.teamId || uid('team'),
      data: { handler: v('handler'), dogName: v('dog', 'dogName'), dogBirthDate: v('geburtsdatum', 'dogBirthDate'), dogBreed: v('rasseFrei', 'dogBreed'),
        disciplines: v('disciplines') || [], indicationType: v('indicationType') },
      fieldMeta: { handler: mm('handler'), dogName: mm('dog', 'dogName'), dogBirthDate: mm('geburtsdatum', 'dogBirthDate'), dogBreed: mm('rasseFrei', 'dogBreed') } };
    const out = buildPackage({ packageType: 'team', packageId: p.packageId, createdAt: p.createdAt, source: { app: p.sourceApp || 'legacy-v1' }, records: [rec] });
    addTeamFromRecord(out, rec, out.source);
    return out;
  }

  function addTeamFromRecord(out, r, source) {
    const d = r.data || {};
    const personId = 'p-' + r.id, hundId = 'h-' + r.id;
    if (!out.personen.some(x => x.id === personId)) out.personen.push({ id: personId, name: str(d.handler), rolle: ['hundefuehrer'] });
    if (!out.hunde.some(x => x.id === hundId)) out.hunde.push({ id: hundId, rufname: str(d.dogName), geburtsdatum: str(d.dogBirthDate) || null, rasse: str(d.dogBreed),
      sparten: (Array.isArray(d.disciplines) ? d.disciplines : str(d.disciplines).split(/[,;/]+/)).map(normSparte).filter(Boolean) });
    const sparten = out.hunde.find(x => x.id === hundId).sparten;
    (sparten.length ? sparten : ['sonstiges']).forEach(sp => {
      const id = r.id + ':' + sp;                 // ein Team je Sparte
      if (!out.teams.some(x => x.id === id)) out.teams.push({ id, personId, hundId, sparte: sp, status: 'in_ausbildung',
        anzeigeart: normAnzeige(d.indicationType), quelleTeamId: r.id, quelleApp: source && source.app });
    });
  }

  /* ---------- Assistenten-Brücken ---------- */
  function fromFlaeche(b) {
    const out = buildPackage({ packageType: b.mode === 'einsatz' ? 'einsatz' : 'training',
      packageId: b.exportId, createdAt: b.exportedAt, source: { app: 'rh-flaechensuchassistent', appVersion: str(b.appVersion || '') } });
    const teamId = b.rhsExchange && b.rhsExchange.teamId ? b.rhsExchange.teamId + ':flaeche' : '';
    const g = b.gebiet || {}, w = b.wetter || {}, a = b.auftrag || {};
    const e = newEntry({
      teamId, typ: b.mode === 'pruefung' ? 'pruefung' : (b.mode === 'einsatz' ? 'einsatz' : 'training'), sparte: 'flaeche',
      beginn: w.searchTime || b.exportedAt, ort: { name: str(g.placeName), lat: num(g.latitude), lon: num(g.longitude), gelaendeart: str(g.terrain) },
      wetter: { tempC: num(w.temperature), luftfeuchteProzent: num(w.humidity), windRichtungGrad: num(w.windDirectionDeg), windKategorie: str(w.windSpeedCategory),
        niederschlag: str(w.precipitation), sonne: str(w.sun), boden: str(w.ground), bodenwindBeobachtet: str(w.windObserved), bodenwindRichtung: str(w.groundWindDirection) },
      ziel: str(a.incidentWhat),
      nutzlast: {
        gebiet: g.polygon || b.polygon || null, gebietGroesse: str(g.areaSize), bewuchsdichte: str(g.vegetation), wegedichte: str(g.pathDensity),
        hangausrichtung: str(g.slopeAspect), wegenetz: g.wegenetz || null, laufschema: b.taktik && b.taktik.laufschema || str(b.laufschema || ''),
        trackHund: trackPoints(b.dogTrack || b.tracks && b.tracks.dog), trackFuehrer: trackPoints(b.handlerTrack || b.tracks && b.tracks.handler),
        versteckpersonen: (b.versteckpersonen || b.subjects || []).map(vp => ({ kuerzel: kuerzel(vp.kuerzel || vp.name), gefunden: !!vp.found || !!vp.gefunden,
          anzeige: { art: normAnzeige(vp.indication || vp.anzeige), qualitaet: num(vp.quality) }, position: vp.position || null })),
        personenzahl: num(b.personenzahl), pruefungsuhr: b.pruefung || null,
        auftrag: a, bewertungRoh: b.bewertung || b.evaluation || null
      },
      bewertung: { ergebnis: b.result && b.result.found ? 'erfolgreich' : 'offen', freitext: str(b.bewertung && b.bewertung.text) },
      quelle: { app: 'rh-flaechensuchassistent', schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: 'rhs-taktik-assistent-export v' + (b.bridgeVersion || 1) },
      roh: b
    });
    out.records.push(e);
    return out;
  }

  function fromMantrailing(b) {
    const S = b.state || {};
    const out = buildPackage({ packageType: S.mode === 'Einsatz' ? 'einsatz' : 'training', createdAt: b.createdAt, source: { app: 'rh-mantrailing-assistent', appVersion: str(b.appVersion || '') } });
    const e = newEntry({
      typ: S.mode === 'Einsatz' ? 'einsatz' : (S.mode === 'Prüfung' ? 'pruefung' : 'training'), sparte: 'mantrailing',
      beginn: S.searchStartAt || S.createdAt || b.createdAt,
      ort: { name: str(S.lkp || S.place), lat: null, lon: null },
      wetter: { tempC: num(S.wxTemp), luftfeuchteProzent: num(S.wxHumidity), windRichtung: str(S.wxWindDir), windKmh: num(S.wxWind), boeenKmh: num(S.wxGust), niederschlag: str(S.wxPrecip) },
      helfer: S.layer ? [{ kuerzel: kuerzel(S.layer), rolle: 'spurleger' }] : [],
      nutzlast: {
        trailart: { hot: /hot/i.test(str(S.saType)), cold: /cold/i.test(str(S.saType)), blind: S.refMode === 'blind', doubleBlind: S.refMode === 'double' },
        ansatzart: str(S.saType), ansatzbereich: { artGroesse: str(S.plsArea), moeglicheAbgaenge: str(S.plsExits) },
        geruchsartikel: (S.articles || []).map(x => typeof x === 'string' ? { art: x } : x),
        trailAlterMin: num(S.trailAgeMin) ?? (num(S.trailAgeHours) != null ? num(S.trailAgeHours) * 60 : null),
        gelegtAm: S.laid || null,
        trackHund: trackPoints(S.track), trackSpurleger: trackPoints(S.referenceTrack), zeitTrack: S.timeTrack || [],
        gpsEreignisse: (S.events || []).map(ev => ({ zeit: ev.t || ev.time || ev.zeit || null, lat: num(ev.lat), lon: num(ev.lon), typ: str(ev.type || ev.typ || ev.label), text: str(ev.note || ev.text) })),
        startverhalten: str(S.startQ), plsTyp: str(S.plsType), plsErgebnis: str(S.plsResult), plsSicherheit: num(S.plsConfidence),
        kreuzungsentscheidung: { sicherheit: num(S.crossConfidence), verhalten: str(S.crossBehavior) },
        negativAusschluss: { arbeit: str(S.negativeWork), kontext: str(S.negativeContext) },
        personendifferenzierung: str(S.personDiff),
        endpool: { erkennbar: str(S.endPool), ausarbeitung: str(S.endPoolDog), auffindesituation: str(S.findSituation) },
        gefunden: /gefunden|Trail bis/i.test(str(S.result)), anzeige: { art: normAnzeige(S.indication), qualitaet: null },
        funde: S.finds || []
      },
      bewertung: { ergebnis: /gefunden|Trail bis/i.test(str(S.result)) ? 'erfolgreich' : (/abgebrochen/i.test(str(S.result)) ? 'abgebrochen' : (/Negativ/i.test(str(S.result)) ? 'erfolgreich' : 'offen')),
        zusatzskalen: [['progStart', 'Start'], ['progSearch', 'Sucharbeit'], ['progFind', 'Fund']].filter(([k]) => S[k] != null && S[k] !== '').map(([k, l]) => ({ schluessel: k, wert: num(S[k]), beschriftung: l })),
        freitext: str(S.notes) },
      quelle: { app: 'rh-mantrailing-assistent', schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: 'rhs-mantrailing-assistent-export v' + (b.schemaVersion || 1) },
      roh: b
    });
    out.records.push(e);
    return out;
  }

  function fromTruemmer(b) {
    const S = b.state || {}, P = b.protocol || {};
    const out = buildPackage({ packageType: S.mode === 'Einsatz' ? 'einsatz' : 'training', createdAt: b.createdAt, source: { app: 'rh-truemmersuchassistent', appVersion: str(b.appVersion || '') } });
    const marks = S.rubbleMarksGeo || S.rubbleMarks || {};
    const e = newEntry({
      typ: S.mode === 'Einsatz' ? 'einsatz' : (S.mode === 'Prüfung' ? 'pruefung' : 'training'), sparte: 'truemmer',
      beginn: S.searchStartAt || S.createdAt || b.createdAt,
      ort: { name: str(S.site || P.ort), lat: null, lon: null },
      wetter: S.weather || P.wetter || {},
      nutzlast: {
        truemmerart: str(S.rubbleType || P.truemmerart), gebiet: S.searchAreaPolygon || null,
        sektoren: (S.sectorList || []).map(s => ({ name: str(s.name || s), status: str(s.status) })),
        suchphase: str(S.phase || P.suchphase),
        sicherheitsCheckliste: S.safety || P.sicherheit || {}, gefahren: S.hazards || [],
        trackHund: trackPoints(S.dogTrackGeo && S.dogTrackGeo.length ? S.dogTrackGeo : S.track), zeitTrack: S.timeTrack || [],
        gpsEreignisse: (S.events || []).map(ev => ({ zeit: ev.t || ev.time || null, lat: num(ev.lat), lon: num(ev.lon), typ: str(ev.type || ev.label), text: str(ev.note || ev.text) })),
        versteckpersonen: (S.finds || []).map(f => ({ kuerzel: kuerzel(f.kuerzel || f.name || 'VP'), gefunden: f.found !== false,
          anzeige: { art: normAnzeige(f.indication) || 'verbeller', qualitaet: num(f.quality), pruefungsberechtigt: (normAnzeige(f.indication) || 'verbeller') === 'verbeller' },
          positionen: { hfVermutung: f.estimate || null, hundTatsaechlich: f.dogActual || null, vpTatsaechlich: f.actual || null },
          geruchsaustritt: f.scentExit || [], vpLage: str(f.vpNote), zeitBisFundMin: num(f.minutes) })),
        fundlagenGesamt: { hfVermutung: marks.estimate || [], hundTatsaechlich: marks.dogActual || [], vpTatsaechlich: marks.actual || [] },
        ruhephasen: (S.events || []).filter(ev => /ruhe/i.test(str(ev.type || ev.label))),
        skizze: S.rubbleDrawing && S.rubbleDrawing.length ? { art: 'skizze', format: 'strokes', daten: S.rubbleDrawing, breiteM: num(S.mapWidthM) } : null,
        meldungEL: P.meldung || null, protokoll: P
      },
      bewertung: { ergebnis: P.ergebnis === true || /erfolg/i.test(str(P.ergebnis)) ? 'erfolgreich' : 'offen', freitext: str(P.notizen || P.bemerkung) },
      anhaenge: (S.photos || []).map(ph => ({ id: ph.id || uid('a'), art: 'foto', format: 'jpg', daten: ph.data || null, aufnahmeort: ph.pos || null, notiz: str(ph.note) })),
      quelle: { app: 'rh-truemmersuchassistent', schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: 'rhs-truemmersuchassistent-export v' + (b.schemaVersion || 1) },
      roh: b
    });
    out.records.push(e);
    return out;
  }

  function scrubNames(d) {
    (d.helfer || []).forEach(h => { if (h.name) { h.kuerzel = h.kuerzel || kuerzel(h.name); delete h.name; } });
    const vps = d.nutzlast && d.nutzlast.versteckpersonen || [];
    vps.forEach(v => { if (v.name) { v.kuerzel = v.kuerzel || kuerzel(v.name); delete v.name; } });
  }

  /* ---------- Validierung ---------- */
  function validate(p) {
    const f = [];
    if (!isObj(p)) return { ok: false, fehler: ['Kein Objekt'] };
    if (p.rhsFormat !== EXCHANGE_FORMAT) f.push('rhsFormat muss "' + EXCHANGE_FORMAT + '" sein');
    if (Number(p.schemaVersion) !== SCHEMA) f.push('schemaVersion muss ' + SCHEMA + ' sein');
    if (!p.packageId) f.push('packageId fehlt');
    if (!p.createdAt || isNaN(Date.parse(p.createdAt))) f.push('createdAt fehlt oder ist kein ISO-Datum');
    if (!isObj(p.source) || !p.source.app) f.push('source.app fehlt');
    ['personen', 'hunde', 'teams', 'records'].forEach(k => { if (!Array.isArray(p[k])) f.push(k + ' muss eine Liste sein'); });
    const ids = new Set();
    (p.records || []).forEach((r, i) => {
      const pre = 'records[' + i + '] ';
      if (!r || !r.type) f.push(pre + 'type fehlt');
      if (!r || !r.id) f.push(pre + 'id fehlt');
      else if (ids.has(r.type + ':' + r.id)) f.push(pre + 'doppelte id ' + r.id); else ids.add(r.type + ':' + r.id);
      if (r && r.type === 'entry') {
        const d = r.data || {};
        if (!TYPEN.includes(d.typ)) f.push(pre + 'typ ungültig: ' + d.typ);
        if (!SPARTEN.includes(d.sparte)) f.push(pre + 'sparte ungültig: ' + d.sparte);
        if (!d.beginn || isNaN(Date.parse(d.beginn))) f.push(pre + 'beginn fehlt oder ungültig');
        if (d.bewertung && d.bewertung.ergebnis && !ERGEBNIS.includes(d.bewertung.ergebnis)) f.push(pre + 'bewertung.ergebnis ungültig');
        ['schwierigkeit', 'hundeleistung', 'fuehrerleistung', 'selbststaendigkeit', 'zusammenarbeit'].forEach(k => {
          const v = d.bewertung && d.bewertung[k]; if (v != null && (v < 1 || v > 5)) f.push(pre + 'bewertung.' + k + ' außerhalb 1–5');
        });
        (d.helfer || []).forEach(h => { if (h.name) f.push(pre + 'helfer enthält vollen Namen (nur Kürzel erlaubt)'); });
        ((d.nutzlast || {}).versteckpersonen || []).forEach(v => { if (v.name) f.push(pre + 'versteckperson enthält vollen Namen (nur Kürzel erlaubt)'); });
        if (d.sparte === 'truemmer') ((d.nutzlast || {}).versteckpersonen || []).forEach(v => {
          const art = v.anzeige && v.anzeige.art; if (art && !ANZEIGEARTEN.truemmer.includes(art)) f.push(pre + 'Anzeigeart in Trümmern nicht vorgesehen: ' + art);
        });
      }
    });
    (p.hunde || []).forEach(h => { if (h.chipnummer) f.push('hunde: chipnummer darf nicht exportiert werden'); });
    return { ok: f.length === 0, fehler: f };
  }

  /* ---------- Zusammenführen ---------- */
  function merge(localRecords, pkg) {
    const local = Array.isArray(localRecords) ? localRecords : [];
    const byKey = new Map(local.map(r => [r.type + ':' + r.id, r]));
    let neu = 0, aktualisiert = 0, unveraendert = 0; const konflikte = [];
    (pkg.records || []).forEach(r => {
      const k = r.type + ':' + r.id, l = byKey.get(k);
      if (!l) { byKey.set(k, clone(r)); neu++; return; }
      if (JSON.stringify(l.data) === JSON.stringify(r.data)) { unveraendert++; return; }
      const lr = Number((l.fieldMeta || {}).revision || 0), rr = Number((r.fieldMeta || {}).revision || 0);
      if (rr > lr) { byKey.set(k, clone(r)); aktualisiert++; }
      else if (rr < lr) { unveraendert++; }
      else konflikte.push({ id: r.id, type: r.type, lokal: l, import: r });
    });
    return { records: Array.from(byKey.values()), neu, aktualisiert, unveraendert, konflikte };
  }

  /* ---------- Außenformate ---------- */
  const xml = s => str(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function toGpx(entry) {
    const d = entry.data || entry, n = d.nutzlast || {};
    const trk = (name, pts) => pts && pts.length ? '  <trk><name>' + xml(name) + '</name><trkseg>' +
      pts.map(p => '<trkpt lat="' + p.lat + '" lon="' + p.lon + '">' + (p.hoehe != null ? '<ele>' + p.hoehe + '</ele>' : '') + (p.zeit ? '<time>' + xml(p.zeit) + '</time>' : '') + '</trkpt>').join('') + '</trkseg></trk>\n' : '';
    const wpts = (n.versteckpersonen || []).filter(v => v.position && v.position.lat != null).map(v => '  <wpt lat="' + v.position.lat + '" lon="' + v.position.lon + '"><name>' + xml('VP ' + v.kuerzel) + '</name></wpt>\n').join('');
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="rhs-exchange" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <metadata><name>' + xml(d.sparte + ' ' + str(d.beginn).slice(0, 10)) + '</name><desc>' + xml((d.bewertung || {}).ergebnis || '') + '</desc>' +
      '<extensions><rhs:entryId>' + xml(entry.id || '') + '</rhs:entryId></extensions></metadata>\n' +
      wpts + trk('Hund', n.trackHund) + trk('Hundeführer', n.trackFuehrer) + trk('Spurleger', n.trackSpurleger) + '</gpx>\n';
  }

  const CSV_SPALTEN = ['id', 'teamId', 'typ', 'sparte', 'beginn', 'ende', 'ort', 'ergebnis', 'schwierigkeit', 'hundeleistung', 'fuehrerleistung', 'selbststaendigkeit', 'zusammenarbeit', 'naechsterSchritt', 'kmHinRueck', 'quelleApp'];
  function toCsvRows(entries) {
    const rows = [CSV_SPALTEN];
    (entries || []).forEach(e => { const d = e.data || e, b = d.bewertung || {};
      rows.push([e.id || '', d.teamId, d.typ, d.sparte, d.beginn, d.ende || '', (d.ort || {}).name || '', b.ergebnis || '', b.schwierigkeit ?? '', b.hundeleistung ?? '', b.fuehrerleistung ?? '', b.selbststaendigkeit ?? '', b.zusammenarbeit ?? '', b.naechsterSchritt || '', d.kmHinRueck ?? '', (d.quelle || {}).app || '']); });
    return rows;
  }
  function toCsv(entries, sep) {
    sep = sep || ';';
    return toCsvRows(entries).map(r => r.map(v => { const s = str(v); return /[;"\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(sep)).join('\r\n');
  }

  async function checksum(records) {
    const text = JSON.stringify(records || []);
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return 'sha256:' + Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (typeof require === 'function') { return 'sha256:' + require('crypto').createHash('sha256').update(text).digest('hex'); }
    return null;
  }

  return { EXCHANGE_FORMAT, SCHEMA, SPARTEN, TYPEN, ERGEBNIS, ANZEIGEARTEN, ANZEIGE_PRUEFUNGSBERECHTIGT, CSV_SPALTEN,
    detect, normalize, validate, buildPackage, newEntry, merge, toGpx, toCsvRows, toCsv, checksum,
    hilfen: { kuerzel, normAnzeige, normSparte, trackPoints, uid } };
});
