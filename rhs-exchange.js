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
  const num = v => { if (v == null || v === '') return null; const n = Number(typeof v === 'string' ? v.replace(',', '.') : v); return Number.isFinite(n) ? n : null; };
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
    if (/fl(ä|ae|a)ch/.test(s)) return 'flaeche';
    if (/tr(ü|ue|u)mm/.test(s)) return 'truemmer';
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
        helfer: (o.helfer || []).map(h => typeof h === 'string' ? { kuerzel: kuerzel(h) } : (function (x) { const o = Object.assign({}, x, { kuerzel: kuerzel(x.kuerzel || x.name) }); delete o.name; return o; })(h)),
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
    if (obj.bridgeFormat === 'rhs-truemmersuchassistent-export' || /^rhs-truemmersuchassistent-back/.test(str(obj.format))) return 'truemmer-bridge';
    if (/^rhs-flaechensuchassistent-eval/.test(str(obj.evaluationFormat))) return 'flaeche-eval';
    if (obj.backupFormat === 'rhs-trainingstagebuch' && Array.isArray(obj.entries)) return 'tagebuch-rha';
    if (obj.format === 'rhs-mantrailing-tagebuch' && Array.isArray(obj.entries)) return 'tagebuch-mt';
    if (obj.format === 'rhs-mantrailing-training-backup' && isObj(obj.state)) return 'tagebuch-mt';
    if (/^rhs-(mantrailing|truemmer\w*|flaeche\w*)-protokolle$/.test(str(obj.format)) && Array.isArray(obj.records)) return 'protokolle';
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
      case 'protokolle': return fromProtokolle(obj);
      case 'flaeche-eval': return fromFlaecheEval(obj);
      case 'tagebuch-rha': return fromTagebuchRHA(obj);
      case 'tagebuch-mt': return fromTagebuchMT(obj);
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
      id: b.exportId ? 'fl-' + str(b.exportId) : undefined,
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
      id: 'mt-' + str(S.createdAt || b.createdAt).replace(/\W/g, ''),
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
    teamAusText(out, e, 'mantrailing', S.rhsExchange && S.rhsExchange.team);
    return out;
  }

  function fromTruemmer(b) {
    const S = b.state || {}, P = b.protocol || {}, ch = Object.assign({}, S.chips || {}, P.chips || {});
    const modus = str(S.mode || P.mode);
    const out = buildPackage({ packageType: /einsatz/i.test(modus) ? 'einsatz' : 'training', createdAt: b.createdAt, source: { app: 'rh-truemmersuchassistent', appVersion: str(b.appVersion || '') } });
    const led = v => { const m = str(v).match(/^\s*([1-5])/); return m ? Number(m[1]) : null; };   // "3 – wechselhaft" -> 3
    const beginn = P.startAt || S.searchStartAt || S.createdAt || b.createdAt;
    const kpi = P.kpi || {}; const dauerS = num(kpi.dur);
    const finds = (P.finds && P.finds.length ? P.finds : S.finds || []);
    const marks = S.rubbleMarksGeo && (S.rubbleMarksGeo.actual || []).length ? S.rubbleMarksGeo : (S.rubbleMarks || {});
    const prog = P.progress || {}; const zs = [];
    [['start', 'Start', prog.start || S.progStart], ['search', 'Sucharbeit', prog.search], ['find', 'Fund/Anzeige', prog.find], ['micro', 'Mikrolokalisierung', P.microNum]].forEach(([k, l, v]) => { const n = led(v) ?? num(v); if (n != null && n >= 1 && n <= 5) zs.push({ schluessel: k, wert: n, beschriftung: l }); });
    const teamText = str(S.team || P.team); const tx = (S.rhsExchange && S.rhsExchange.team) || {};
    const e = newEntry({
      id: P.id ? 'tr-' + P.id : 'tr-' + str(S.createdAt).replace(/\W/g, ''), typ: /einsatz/i.test(modus) ? 'einsatz' : /pr[üu]f/i.test(modus) ? 'pruefung' : 'training', sparte: 'truemmer',
      beginn, ende: dauerS ? new Date(Date.parse(beginn) + dauerS * 1000).toISOString() : (kpi.end || null),
      ort: { name: str(S.place || P.place), lat: num(S.weatherLat), lon: num(S.weatherLon) },
      wetter: { tempC: num(S.wxTemp ?? (P.weather || {}).temp), luftfeuchteProzent: num(S.wxHumidity ?? (P.weather || {}).hum), windRichtungGrad: num(S.wxWindDir ?? (P.weather || {}).windDir), windKmh: num(S.wxWind ?? (P.weather || {}).wind), boeenKmh: num(S.wxGust ?? (P.weather || {}).gust), niederschlag: str(S.wxPrecip ?? (P.weather || {}).precip), wetterCode: num(S.wxCode), sonne: str(S.sunState || (P.tips || {}).sunState), tagesphase: str(S.dayPhase || (P.tips || {}).dayPhase), luftbewegung: str(S.airObs || (P.tips || {}).airObs), abgerufenAm: S.weatherAt || null },
      nutzlast: {
        teamText, personName: str(tx.handler), hundName: str(tx.dogName),
        truemmerart: ch.structure || [], gefahren: ch.hazards || [], suchphase: ch.pattern || [], geruchsaustritt: ch.scent || [], sicherheitsCheckliste: ch.safetyCheck || [], geruchsweg: ch.scentPath || [],
        sicherheitNotiz: str(P.safety), auftrag: str(P.brief), sektorenText: str(P.sectorsText), geruchsNotiz: str(P.scentNotes), sektoren: (P.sectors && P.sectors.length ? P.sectors : S.sectorList || []).map(x => typeof x === 'string' ? { name: x } : x),
        gebiet: S.searchAreaPolygon || null,
        vpZeitImVersteckH: str(S.vpHours || (P.tips || {}).vpHours), suchmodus: str(S.searchMode || (P.ratings || {}).searchMode), selbststaendig: str(S.independent || (P.ratings || {}).independent), mikrolokalisierung: str(S.micro || (P.ratings || {}).micro), sichtkontakt: str((P.ratings || {}).visualContact), bewegung: str((P.ratings || {}).movement), verbellen: str((P.ratings || {}).bark),
        trackHund: trackPoints(S.dogTrackGeo && S.dogTrackGeo.length ? S.dogTrackGeo : S.track), zeitTrack: S.timeTrack || [], trackPunkte: num(kpi.pts),
        gpsEreignisse: (S.events && S.events.length ? S.events : P.events || []).map(ev => ({ zeit: ev.at || ev.t || null, lat: num(ev.lat), lon: num(ev.lon), typ: str(ev.type), text: str(ev.note) })),
        versteckpersonen: finds.map((f, i) => ({ kuerzel: kuerzel(f.kuerzel || f.name || ('VP' + (i + 1))), gefunden: /gefunden/i.test(str(f.result)) || f.found === true, ergebnisText: str(f.result), markierung: str(f.marking), sektor: str(f.sector), quelle: str(f.source), zweithund: str(f.secondDog), zeit: f.at || null,
          anzeige: { art: /sitz/i.test(str(f.bark)) ? 'sitzen_fundstelle' : 'verbeller', qualitaet: null, pruefungsberechtigt: !/sitz/i.test(str(f.bark)), verbellenText: str(f.bark) },
          position: f.lat != null ? { lat: num(f.lat), lon: num(f.lon), genauigkeitM: num(f.acc) } : null, positionen: { hfVermutung: f.estimate || null, hundTatsaechlich: f.dogActual || null, vpTatsaechlich: f.actual || null }, verschuettungTiefe: str(f.depth), notiz: str(f.note) })),
        fundlagenGesamt: { hfVermutung: marks.estimate || [], hundTatsaechlich: marks.dogActual || [], vpTatsaechlich: marks.actual || [] },
        kennzahlen: { dauerS, zeitBisErstemFundS: num(kpi.tFirst), funde: num(kpi.finds), vp: num(kpi.vp), fehlanzeigen: num(kpi.fehl), sektorenNegativ: num(kpi.sektNeg), sektorenGesamt: num(kpi.sektAll) },
        analyse: P.analysis || null, protokollFelder: Object.assign({}, S.proto || {}, P.proto || {}), pruefung: P.exam || null,
        skizze: S.rubbleDrawing && S.rubbleDrawing.length ? { art: 'skizze', format: 'strokes', daten: S.rubbleDrawing, breiteM: num(S.mapWidthM) } : null,
        ruhephasen: (S.events || []).filter(ev => /ruhe/i.test(str(ev.type)))
      },
      bewertung: { ergebnis: finds.some(f => /gefunden/i.test(str(f.result))) ? 'erfolgreich' : /abgebrochen/i.test(str((P.analysis || {}).findResult)) ? 'abgebrochen' : 'offen', hundeleistung: num(P.ratingNum), zusatzskalen: zs,
        naechsterSchritt: str((P.debrief || {}).next), freitext: [str((P.debrief || {}).good) && 'Gut: ' + P.debrief.good, str((P.debrief || {}).debrief), str((P.proto || S.proto || {}).rating) && 'Gesamteindruck: ' + (P.proto || S.proto).rating, str((P.proto || S.proto || {}).load) && 'Belastung: ' + (P.proto || S.proto).load].filter(Boolean).join('\n') },
      anhaenge: (S.photos && S.photos.length ? S.photos : P.photos || []).map(ph => ({ id: ph.id || uid('a'), art: 'foto', format: 'jpg', daten: ph.data || null, aufnahmeort: ph.pos || (ph.lat != null ? { lat: num(ph.lat), lon: num(ph.lon) } : null), notiz: str(ph.note) })),
      quelle: { app: 'rh-truemmersuchassistent', appVersion: str(b.appVersion || ''), schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: str(b.bridgeFormat || b.format) + ' v' + (b.schemaVersion || b.version || 1) },
      roh: b, fieldMeta: { revision: 1, updatedAt: P.savedAt || S.updatedAt || nowIso() }
    });
    out.records.push(e);
    teamAusText(out, e, 'truemmer', tx);
    return out;
  }

  // Auswertungsdatei des Flächensuchassistenten (nur Bewertung, keine Suchdaten)
  function fromFlaecheEval(b) {
    const out = buildPackage({ packageType: b.mode === 'einsatz' ? 'einsatz' : 'training', createdAt: b.evaluatedAt, source: { app: 'rh-flaechensuchassistent', appVersion: str(b.appVersion || '') } });
    const zs = []; const lab = { evalHandlerBriefing: 'Einweisung', evalHandlerTactics: 'Taktik', evalHandlerCoverage: 'Abdeckung (HF)', evalHandlerDogReading: 'Hund lesen', evalHandlerCommunication: 'Kommunikation', evalHandlerSafety: 'Sicherheit', evalHandlerInquiry: 'Erkundung', evalHandlerReport: 'Meldung', evalDogIndependence: 'Selbstständigkeit', evalDogWindUse: 'Windnutzung', evalDogCoverage: 'Abdeckung (Hund)', evalDogMotivation: 'Motivation', evalDogManageability: 'Führbarkeit', evalDogIndication: 'Anzeige', evalDogPersonBehavior: 'Verhalten an der Person', evalDogEndurance: 'Ausdauer' };
    Object.entries(Object.assign({}, (b.handler || {}).ratings || {}, (b.dog || {}).ratings || {})).forEach(([k, v]) => { const n = num(v); if (n != null) zs.push({ schluessel: k, wert: n, beschriftung: lab[k] || k }); });
    const r = b.result || {};
    const e = newEntry({ id: 'fl-' + str(b.exportId) + '-auswertung', typ: b.mode === 'einsatz' ? 'einsatz' : b.mode === 'pruefung' ? 'pruefung' : 'training', sparte: 'flaeche', beginn: b.evaluatedAt,
      nutzlast: { nurAuswertung: true, exportId: str(b.exportId), personenGeplant: num(r.plannedPersons), fundeDokumentiert: num(r.documentedFinds), ergebnisText: str(r.outcomeLabel), einflussfaktoren: b.factors || [], planNutzung: (b.planUse || {}).label || null, bewerterRolle: str(b.evaluatorRole) },
      bewertung: { ergebnis: r.outcome === 'success' ? 'erfolgreich' : r.outcome === 'partial' ? 'teilweise' : r.outcome === 'fail' ? 'nicht_erfolgreich' : 'offen', fuehrerleistung: (b.handler || {}).average != null ? Math.round(b.handler.average) : null, hundeleistung: (b.dog || {}).average != null ? Math.round(b.dog.average) : null, zusatzskalen: zs, naechsterSchritt: str(b.nextFocus), freitext: [str(b.strengths) && 'Stärken: ' + b.strengths, str(b.notes)].filter(Boolean).join('\n') },
      quelle: { app: 'rh-flaechensuchassistent', schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: str(b.evaluationFormat) + ' v' + (b.evaluationVersion || 1) }, roh: b, fieldMeta: { revision: 1, updatedAt: b.evaluatedAt } });
    out.records.push(e); return out;
  }

  // Person/Hund/Team aus Freitext "Name/Hund" oder rhsExchange.team ableiten (Standalone-Import)
  function teamAusText(out, e, sparte, tx) {
    const n = e.data.nutzlast; let pn = str(tx && tx.handler) || n.personName || '', hn = str(tx && tx.dogName) || n.hundName || '';
    if (!hn && n.teamText) { const tp = n.teamText.split(/\s*[\/|·]\s*/); if (tp.length > 1) { pn = pn || tp[0]; hn = tp.slice(1).join(' / '); } else hn = tp[0]; }
    if (!hn) return;
    const pid = 'p-' + (kuerzel(pn || 'HF') || 'hf').toLowerCase(), hid = 'h-' + hn.toLowerCase().replace(/\W+/g, '-');
    if (!out.personen.some(x => x.id === pid)) out.personen.push({ id: pid, name: pn, rolle: ['hundefuehrer'] });
    if (!out.hunde.some(x => x.id === hid)) out.hunde.push({ id: hid, rufname: hn, geburtsdatum: str(tx && tx.dogBirthDate) || null, rasse: str(tx && tx.dogBreed), sparten: [sparte] });
    const tid = pid + ':' + hid + ':' + sparte; if (!out.teams.some(x => x.id === tid)) out.teams.push({ id: tid, personId: pid, hundId: hid, sparte, status: 'in_ausbildung', anzeigeart: normAnzeige(tx && tx.indicationType) });
    e.data.teamId = tid; n.personName = pn; n.hundName = hn;
  }

  // Protokoll-Sicherung der Assistenten („Protokolle sichern (JSON)“): format 'rhs-<sparte>-protokolle', records[] je Vorgang
  function fromProtokolle(b) {
    const sparte = normSparte(str(b.format).replace(/^rhs-/, '').replace(/-protokolle$/, ''));
    const app = 'rh-' + (sparte === 'mantrailing' ? 'mantrailing-assistent' : sparte === 'truemmer' ? 'truemmersuchassistent' : 'flaechensuchassistent');
    const out = buildPackage({ packageType: 'training', createdAt: b.exportedAt, source: { app, appVersion: str(b.appVersion || '') } });
    const skala = v => { const n = num(v); return n != null && n >= 1 && n <= 5 ? n : null; };
    (b.records || []).forEach(r => {
      const beginn = r.date ? new Date(r.date).toISOString() : (r.savedAt || b.exportedAt);
      const dauerS = num(r.durationSec);
      const zs = [];
      [['progStart', 'Start'], ['progSearch', 'Sucharbeit'], ['progFind', 'Fund'], ['crossConf', 'Kreuzungssicherheit'], ['plsConf', 'Ansatzsicherheit'], ['drive', 'Finderwille'], ['focus', 'Konzentration'], ['load', 'Belastbarkeit'], ['handling', 'Handling HF'], ['independent', 'Selbstständigkeit']]
        .forEach(([k, l]) => { const v = skala(r[k]); if (v != null) zs.push({ schluessel: k, wert: v, beschriftung: l }); });
      const res = str(r.result);
      const erg = /gefunden|Trail bis|Negativ korrekt|erfolg/i.test(res) ? 'erfolgreich' : /abgebrochen/i.test(res) ? 'abgebrochen' : /nicht gefunden|ohne Ergebnis/i.test(res) ? 'nicht_erfolgreich' : /teil/i.test(res) ? 'teilweise' : 'offen';
      const e = newEntry({
        id: r.id, typ: /einsatz/i.test(str(r.mode)) ? 'einsatz' : /prüf|pruef/i.test(str(r.mode)) ? 'pruefung' : 'training', sparte,
        beginn, ende: dauerS ? new Date(Date.parse(beginn) + dauerS * 1000).toISOString() : null,
        ort: { name: str(r.place || r.lkp || r.startEnv), lat: null, lon: null },
        wetter: { tempC: num(r.temp), windKmh: num(r.wind), windRichtung: isNaN(Number(r.wind)) ? str(r.wind) : '', niederschlag: str(r.precip) },
        helfer: r.layer ? [{ kuerzel: kuerzel(r.layer), rolle: 'spurleger' }] : [],
        nutzlast: {
          teamText: str(r.team),
          trailAlterMin: num(r.trailAgeH) != null ? Math.round(num(r.trailAgeH) * 60) : null, gelegtAm: r.laidAt || null,
          trailart: { text: str(r.ptype) }, distanzGeplantM: num(r.distPlanned),
          umfeldStart: str(r.startEnv), umfeldSegmente: r.envRoute || [], verleitungen: [str(r.traffic), str(r.lure)].filter(Boolean),
          geruchsartikel: (r.articles || []).map(a => typeof a === 'string' ? { art: a } : a), artikelGesamt: num(r.artTotal), artikelGefunden: num(r.artFound),
          plsErgebnis: str(r.plsResult), plsSek: num(r.plsSec), plsUebergang: str(r.plsToTrail), startverhalten: str(r.startQ),
          endpool: { erkennbar: str(r.endPool), auffindesituation: str(r.end) },
          gefunden: erg === 'erfolgreich', anzeige: { art: normAnzeige(r.indication), qualitaet: null },
          trailLaengeM: num(r.refLenM) || num(r.hfLenM), streckeHFM: num(r.hfLenM), streckeHundM: num(r.dogLenM), streckeSpurlegerM: num(r.refLenM),
          abweichungMittelM: num(r.devAvgM), abweichungMaxM: num(r.devMaxM), ereignisZaehler: r.counts || {},
          gpsEreignisse: (r.events || []).map(ev => ({ zeit: ev.t || ev.at || null, lat: num(ev.lat), lon: num(ev.lon), typ: str(ev.type), text: str(ev.note) })),
          wetterTipps: r.wxTips || null
        },
        bewertung: { ergebnis: erg, hundeleistung: skala(r.rating), zusatzskalen: zs, naechsterSchritt: str(r.goal), trainerbeobachtung: str(r.trainer),
          freitext: [str(r.strengths) && 'Stärken: ' + r.strengths, str(r.debrief), str(r.notes)].filter(Boolean).join('\n') },
        anhaenge: r.thumb ? [{ id: r.id + '-thumb', art: 'skizze', format: 'png', daten: r.thumb, notiz: 'Vorschaubild Track' }] : [],
        quelle: { app, schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: str(b.format) + ' v' + (b.version || 1) },
        roh: r, fieldMeta: { revision: 1, updatedAt: r.savedAt || nowIso() }
      });
      out.records.push(e);
    });
    out.records.forEach(e => teamAusText(out, e, sparte, null));
    return out;
  }

  /* ---------- Alt-Tagebücher (Migration) ---------- */
  const WORT_SKALA = { 'sehr gut': 5, 'gut': 4, 'befriedigend': 3, 'teilweise': 3, 'ausreichend': 2, 'mangelhaft': 1, 'ungenügend': 1, 'sicher': 4, 'sehr sicher': 5, 'wechselhaft': 3, 'unsicher': 2 };
  const skalaAusText = v => { const t = str(v).trim(); if (!t) return null; const m = t.match(/^([1-5])\b/); if (m) return Number(m[1]); const n = num(t); if (n != null && n >= 1 && n <= 5) return n; for (const k in WORT_SKALA) if (t.toLowerCase().startsWith(k)) return WORT_SKALA[k]; return null; };
  const ergebnisAusText = v => { const t = str(v).toLowerCase(); if (!t) return 'offen'; if (/^ja|gefunden|erfolg|bestanden/.test(t)) return 'erfolgreich'; if (/teil|bestätigt|mit hilfe/.test(t)) return 'teilweise'; if (/^nein|nicht gefunden|nicht erfolg|nicht bestanden/.test(t)) return 'nicht_erfolgreich'; if (/abgebrochen/.test(t)) return 'abgebrochen'; return 'offen'; };

  // Trainingstagebuch Rettungshundearbeit (Sicherung, backupFormat 'rhs-trainingstagebuch', v7): Einträge als Label/Wert-Listen
  function fromTagebuchRHA(b) {
    const pr = b.profile || {};
    const out = buildPackage({ packageType: 'bundle', createdAt: b.savedAt, source: { app: 'rh-trainingstagebuch-alt', appVersion: 'backup-v' + (b.backupVersion || '') } });
    const pid = 'p-' + (kuerzel(pr.fuehrer || 'HF') || 'hf').toLowerCase(), hid = 'h-' + str(pr.hund || 'hund').toLowerCase().replace(/\W+/g, '-');
    out.personen.push({ id: pid, name: str(pr.fuehrer), rolle: ['hundefuehrer'], organisation: str(pr.staffel) });
    const sparten = (Array.isArray(pr.disciplines) ? pr.disciplines : []).map(normSparte).filter(Boolean);
    out.hunde.push({ id: hid, rufname: str(pr.hund), geburtsdatum: str(pr.geb) || null, rasse: str(pr.rasse), sparten: sparten.slice() });
    if (pr.teamId) out.records.push({ type: 'team', id: pr.teamId, data: { handler: str(pr.fuehrer), dogName: str(pr.hund), dogBirthDate: str(pr.geb), dogBreed: str(pr.rasse), disciplines: pr.disciplines || [], indicationType: str(pr.indicationType) }, fieldMeta: (pr.exchangeMeta || {}).fieldRevisions ? Object.fromEntries(Object.entries(pr.exchangeMeta.fieldRevisions).map(([k, v]) => [k, { revision: v, updatedAt: (pr.exchangeMeta.fieldUpdatedAt || {})[k] }])) : { revision: (pr.exchangeMeta || {}).revision || 1 } });
    out.orte = (b.trainingPlaces || []).map(o => ({ id: o.id, name: str(o.name), entfernungKm: num(o.distanceKm), gelaendeart: str((o.basic || {})['Geländeart']), beschreibung: Object.entries(o.basic || {}).filter(([k]) => k !== 'Geländeart').map(([k, v]) => k + ': ' + v).join('; '), merkmale: o.chips || {} }));
    const teamFor = sp => { const id = pid + ':' + hid + ':' + sp; if (!out.teams.some(t => t.id === id)) { out.teams.push({ id, personId: pid, hundId: hid, sparte: sp, status: 'in_ausbildung', anzeigeart: normAnzeige(pr.indicationType) }); const h = out.hunde[0]; if (!h.sparten.includes(sp)) h.sparten.push(sp); } return id; };
    (b.entries || []).forEach(en => {
      const F = {}; (en.basic || []).forEach(x => { if (x && x.label) F[x.label] = x.value; });
      const C = {}; (en.chips || []).forEach(x => { if (x && x.label) C[x.label] = x.values || []; });
      const g = (l) => { const gr = (en.groups || []).find(x => x.label === l); return gr ? gr.items.map(it => Object.fromEntries((it || []).map(f => [f.label, f.value]))) : []; };
      const sparte = normSparte(en.discipline || en.disciplineLabel) || 'sonstiges';
      const datum = str(F['Datum']) || str(en.timestamp).slice(0, 10), zeit = str(F['Uhrzeit']) || '12:00';
      const beginn = datum ? new Date(datum + 'T' + zeit).toISOString() : en.timestamp;
      const dauer = num(F['Dauer der eigentlichen Suche']) || num(F['Dauer (Min.)']) || num(F['Dauer']);
      const vps = g('Helfer / Versteckperson').map(v => ({ kuerzel: kuerzel(v['Kürzel / Initialen'] || v['Kürzel'] || 'VP'), rolle: str(v['Rolle']), alterCa: num(v['Alter (ca.)']), geschlecht: str(v['Geschlecht']), bekanntFuerHund: str(v['Bekanntheit für den Hund']), erfahrung: str(v['Erfahrung als Helfer']),
        versteckart: str(v['Versteckart / Position']), sichtbar: str(v['Sichtbarkeit für den Hund']), verhaltenImVersteck: str(v['Verhalten im Versteck']), geruchsintensitaet: str(v['Geruchsintensität / Liegezeit']), zugaenglichkeit: str(v['Zugänglichkeit']), zeitImVersteck: str(v['Zeit im Versteck vor Suchbeginn']), lageImGebiet: str(v['Lage im Suchgebiet']),
        gefunden: /^ja/i.test(str(v['Gefunden / angezeigt'])), gefundenText: str(v['Gefunden / angezeigt']), zeitBisFundMin: num(v['Zeit bis Fund / Anzeige']), verlaufDerSuche: str(v['Verlauf der Suche / Suchqualität']), fuehrbarkeit: str(v['Führbarkeit des Hundes im Gelände']),
        anzeige: { art: normAnzeige(pr.indicationType), qualitaet: skalaAusText(v['Anzeigequalität']), qualitaetText: str(v['Anzeigequalität']) }, latenzAuffindenBisAnzeigeSek: num(v['Latenzzeit Auffinden – Anzeige (Sek.)'] ?? v['Latenzzeit']), distanzHFHundM: num(v['Distanz HF – Hund bei Anzeigebeginn (m)'] ?? v['Distanz HF-Hund']), haltevermoegenSek: num(v['Haltevermögen / Anzeigedauer (Sek.)'] ?? v['Haltevermögen']), fehlverhalten: str(v['Fehlverhalten bei der Anzeige'] || v['Fehlverhalten']), bewertungText: str(v['Bewertung']), alle: v }));
      const bekannt = new Set(['Datum', 'Uhrzeit', 'Ort / Übungsstätte', 'Entfernung zur Heimatadresse (km)', 'Temperatur (°C)', 'Wind', 'Windrichtung', 'Niederschlag', 'Licht-/Sichtverhältnisse', 'Gefühlte Temperatur (°C)', 'Relative Luftfeuchte (%)', 'Windgeschwindigkeit (km/h)', 'Windböen (km/h)', 'Bewölkung (%)', 'Wetterbeschreibung', 'Wetterdaten abgerufen am', 'Erfassungsart Wetter/Ort', 'Bodenwind beobachtet', 'Bodenwind / Witterungsverhalten', 'Geländeart', 'Bewuchsdichte', 'Größe Suchgebiet', 'Dauer der eigentlichen Suche', 'Verlauf / Form / Begrenzung des Suchgebiets', 'Anzeigequalität', 'Gesamtbewertung', 'Zusammenarbeit / Führungsverhalten', 'Auffälligkeiten', 'Lernschritt seit dem vorherigen Training', 'Nächster kleinster Trainingsschritt', 'Weitere relevante Beobachtungen', 'Freitext / Notizen', 'Gesundheitszustand vor dem Training', 'Zustand nach dem Training', 'Ermüdungs-/Schmerzanzeichen', 'Pause vor diesem Block', 'Training drinnen / witterungsunabhängig', 'Selbstständigkeit', 'Ergebnis']);
      const rest = Object.entries(F).filter(([k, v]) => !bekannt.has(k) && str(v)).map(([k, v]) => ({ label: k, value: v }));
      const e = newEntry({ id: 'rha-' + str(en.id), typ: 'training', sparte, beginn, ende: dauer ? new Date(Date.parse(beginn) + dauer * 6e4).toISOString() : null,
        ort: { name: str(F['Ort / Übungsstätte']), lat: null, lon: null, gelaendeart: str(F['Geländeart']) },
        wetter: { tempC: num(F['Temperatur (°C)']), gefuehltC: num(F['Gefühlte Temperatur (°C)']), luftfeuchteProzent: num(F['Relative Luftfeuchte (%)']), windKmh: num(F['Windgeschwindigkeit (km/h)']), boeenKmh: num(F['Windböen (km/h)']), windText: str(F['Wind']), windRichtung: str(F['Windrichtung']), niederschlag: str(F['Niederschlag']), bewoelkungProzent: num(F['Bewölkung (%)']), beschreibung: str(F['Wetterbeschreibung']), lichtSicht: str(F['Licht-/Sichtverhältnisse']), abgerufenAm: str(F['Wetterdaten abgerufen am']) || null, erfassungsart: str(F['Erfassungsart Wetter/Ort']), bodenwindBeobachtet: str(F['Bodenwind beobachtet']), bodenwind: str(F['Bodenwind / Witterungsverhalten']), drinnen: /^ja/i.test(str(F['Training drinnen / witterungsunabhängig'])) },
        nutzlast: Object.assign({ gebietGroesse: str(F['Größe Suchgebiet']), bewuchsdichte: str(F['Bewuchsdichte']), gelaendeart: [str(F['Geländeart'])].filter(Boolean), lichtSicht: str(F['Licht-/Sichtverhältnisse']), verlaufFormBegrenzung: str(F['Verlauf / Form / Begrenzung des Suchgebiets']), suchdauerMin: dauer, pauseVorBlock: str(F['Pause vor diesem Block']),
          untergruende: C['Untergründe'] || [], bewuchs: C['Bewuchs / Vegetation'] || [], gelaendemerkmale: C['Geländemerkmale'] || [], belastungen: C['Besondere Belastungen'] || [], chips: C, weitereFelder: rest, gruppen: (en.groups || []).filter(x => x.label !== 'Helfer / Versteckperson'),
          versteckpersonen: vps, anzeige: { art: normAnzeige(pr.indicationType), qualitaet: skalaAusText(F['Anzeigequalität']), qualitaetText: str(F['Anzeigequalität']) }, bruecke: en.rhBridge || null, taktikImport: en.taktikImport || null }),
        bewertung: { ergebnis: vps.length ? (vps.every(v => v.gefunden) ? 'erfolgreich' : vps.some(v => v.gefunden) ? 'teilweise' : 'nicht_erfolgreich') : ergebnisAusText(F['Ergebnis']), hundeleistung: skalaAusText(F['Gesamtbewertung']), zusammenarbeit: skalaAusText(F['Zusammenarbeit / Führungsverhalten']), selbststaendigkeit: skalaAusText(F['Selbstständigkeit']),
          zusatzskalen: [], gesamtbewertungText: str(F['Gesamtbewertung']), lernschritt: str(F['Lernschritt seit dem vorherigen Training']), naechsterSchritt: str(F['Nächster kleinster Trainingsschritt']), freitext: [str(F['Auffälligkeiten']) && 'Auffälligkeiten: ' + F['Auffälligkeiten'], str(F['Weitere relevante Beobachtungen']), str(F['Freitext / Notizen'])].filter(Boolean).join('\n') },
        hundZustand: { vorher: str(F['Gesundheitszustand vor dem Training']), nachher: str(F['Zustand nach dem Training']), auffaelligkeiten: str(F['Ermüdungs-/Schmerzanzeichen']) },
        kmHinRueck: num(F['Entfernung zur Heimatadresse (km)']) != null ? num(F['Entfernung zur Heimatadresse (km)']) * 2 : null,
        quelle: { app: 'rh-trainingstagebuch-alt', appVersion: 'backup-v' + (b.backupVersion || ''), schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: 'rhs-trainingstagebuch backup v' + (b.backupVersion || '') },
        roh: en, fieldMeta: { revision: 1, updatedAt: en.timestamp || b.savedAt } });
      e.data.teamId = teamFor(sparte); out.records.push(e);
    });
    return out;
  }

  // Trainingstagebuch Mantrailing (Einzelsicherung 'rhs-mantrailing-training-backup' oder Gesamtsicherung 'rhs-mantrailing-tagebuch')
  function fromTagebuchMT(b) {
    const states = Array.isArray(b.entries) ? b.entries.map(x => x.state || x) : [b.state];
    const out = buildPackage({ packageType: 'training', createdAt: b.exportedAt || nowIso(), source: { app: 'rh-mantrailing-tagebuch-alt', appVersion: 'v' + (b.version || '') } });
    states.filter(isObj).forEach(S => {
      const ch = S.chips || {};
      const beginn = S.worked ? new Date(S.worked).toISOString() : (S.date ? new Date(S.date + 'T12:00').toISOString() : S.createdAt);
      const gelegt = S.laid ? new Date(S.laid) : null; const alter = gelegt && S.worked ? Math.round((Date.parse(beginn) - gelegt.getTime()) / 6e4) : null;
      const zs = [];
      [['progStart', 'Start'], ['progSearch', 'Sucharbeit'], ['progFind', 'Fund'], ['crossConfidence', 'Kreuzungssicherheit'], ['focus', 'Konzentration'], ['drive', 'Finderwille']].forEach(([k, l]) => { const v = skalaAusText(S[k]); if (v != null) zs.push({ schluessel: k, wert: v, beschriftung: l }); });
      const e = newEntry({ id: 'mtt-' + str(S.entryId || S.createdAt).replace(/\W/g, ''), typ: 'training', sparte: 'mantrailing', beginn,
        ort: { name: str(S.place), lat: null, lon: null },
        wetter: { tempC: num(S.wxTemp), windKmh: num(S.wxWind), niederschlag: str(S.wxPrecip) },
        helfer: S.layer ? [{ kuerzel: kuerzel(S.layer), rolle: 'spurleger' }] : [],
        nutzlast: { teamText: [str(S.handler), str(S.dog)].filter(Boolean).join('/'), trailart: { text: (ch.trailType || []).join(', ') }, trailAlterMin: alter, gelegtAm: S.laid || null, distanzGeplantM: num(S.plannedDistance),
          umfeld: ch.env || [], verleitungen: ch.disturb || [], sucharbeit: ch.work || [], startverhalten: str(S.startQuality), handling: str(S.handling), negativAusschluss: { arbeit: str(S.negativeWork) }, endpool: { erkennbar: str(S.endPool), ausarbeitung: str(S.endPoolWork) }, personendifferenzierung: str(S.personDiff), belastungText: str(S.load),
          anzeige: { art: normAnzeige(S.indication), qualitaet: null }, trackHund: trackPoints(S.track), trackSpurleger: trackPoints(S.referenceTrack), gpsEreignisse: (S.events || []).map(ev => ({ zeit: ev.at || null, lat: num(ev.lat), lon: num(ev.lon), typ: str(ev.type), text: str(ev.note) })), funde: S.finds || [] },
        bewertung: { ergebnis: S.finds && S.finds.length ? 'erfolgreich' : ergebnisAusText(S.result), hundeleistung: skalaAusText(S.rating), zusatzskalen: zs, naechsterSchritt: str(S.goal || S.nextGoal), trainerbeobachtung: str(S.trainer || S.trainerNote), freitext: [str(S.strengths) && 'Stärken: ' + S.strengths, str(S.notes)].filter(Boolean).join('\n') },
        quelle: { app: 'rh-mantrailing-tagebuch-alt', schemaVersion: SCHEMA, importiertAm: nowIso(), brueckenFormat: str(b.format) + ' v' + (b.version || 1) }, roh: S, fieldMeta: { revision: 1, updatedAt: S.updatedAt || S.diarySavedAt || nowIso() } });
      out.records.push(e); teamAusText(out, e, 'mantrailing', { handler: S.handler, dogName: S.dog });
    });
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
