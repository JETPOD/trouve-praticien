import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "data.db");

const AMELI_FILES = [
  "ameli_Aisne.csv",
  "sample_59.csv",
  "ameli_Oise.csv",
  "sample_62.csv",
  "ameli_Somme.csv",
];

const HDF_DEPS = new Set(["02", "59", "60", "62", "80"]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseCSVLineSemi(line: string): string[] {
  return line.split(";");
}

// Tolerant comma CSV with quoted strings (for rpps_geocoded.csv)
function parseCSVLineComma(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function timeOnly(iso: string): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return iso;
}

function extractCommune(adresse: string, code_postal: string): string {
  if (!adresse) return "";
  if (code_postal) {
    const idx = adresse.indexOf(code_postal);
    if (idx !== -1) {
      const after = adresse.slice(idx + code_postal.length).trim();
      if (after) return after.replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

const JOUR_MAP: Record<string, string> = {
  "1": "Lundi",
  "2": "Mardi",
  "3": "Mercredi",
  "4": "Jeudi",
  "5": "Vendredi",
  "6": "Samedi",
  "7": "Dimanche",
};

// Map a profession label to an APL profession column. Returns "medecins" as fallback.
function aplKeyForProfession(prof: string): "medecins" | "infirmieres" | "sages_femmes" | "kine" | "dentistes" {
  const s = slugify(prof);
  if (s.includes("infirmier")) return "infirmieres";
  if (s.includes("sage-femme") || s.includes("sage-femmes")) return "sages_femmes";
  if (s.includes("kinesith") || s.includes("masseur-kine") || s.includes("kinesitherapeute")) return "kine";
  if (s.includes("dentiste") || s.includes("chirurgien-dentiste")) return "dentistes";
  return "medecins";
}

async function processAmeliFile(
  filePath: string,
  practitioners: Map<string, any>,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let lineNo = 0;
  for await (const rawLine of rl) {
    lineNo++;
    const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (!header) {
      header = parseCSVLineSemi(line);
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCSVLineSemi(line);
    if (cols.length < header.length) continue;
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? "";

    const key = [row.nom, row.code_postal, row.libelle_profession, row.adresse].join("|");
    let p = practitioners.get(key);
    if (!p) {
      let lat: number | null = null,
        lon: number | null = null;
      if (row.coordonnees) {
        const parts = row.coordonnees.split(",").map((s) => s.trim());
        if (parts.length === 2) {
          const la = parseFloat(parts[0]);
          const lo = parseFloat(parts[1]);
          if (!Number.isNaN(la) && !Number.isNaN(lo)) {
            lat = la;
            lon = lo;
          }
        }
      }
      const cnv = (row.convention || "").toLowerCase();
      const convention =
        cnv.includes("non") ? "Non conventionné" :
        cnv.includes("secteur 1") ? "Secteur 1" :
        cnv.includes("secteur 2") ? "Secteur 2" :
        row.convention || "";
      p = {
        source: "ameli",
        rpps: null,
        nom: row.nom,
        civilite: row.civilite,
        profession: row.libelle_profession,
        profession_normalized: slugify(row.libelle_profession),
        code_postal: row.code_postal,
        commune: extractCommune(row.adresse, row.code_postal),
        adresse_full: row.adresse,
        lat,
        lon,
        telephone: row.telephone || null,
        email: null,
        convention,
        mode_exercice: null,
        nature_exercice: row.nature_exercice,
        secteur_activite: null,
        genre_activite: null,
        sesam_vitale: row.sesam_vitale?.toLowerCase().includes("sesam") ? 1 : 0,
        schedule: [] as any[],
        dep_name: row.dep_name,
        code_commune: row.code_commune,
      };
      practitioners.set(key, p);
    }
    if (row.jour && row.heure_debut && row.heure_fin) {
      const slot = {
        jour: JOUR_MAP[row.jour] || row.jour,
        heure_debut: timeOnly(row.heure_debut),
        heure_fin: timeOnly(row.heure_fin),
        type_consultation: row.type_consultation || undefined,
      };
      const sig = `${slot.jour}|${slot.heure_debut}|${slot.heure_fin}|${slot.type_consultation || ""}`;
      if (!p.schedule.some((s: any) =>
        `${s.jour}|${s.heure_debut}|${s.heure_fin}|${s.type_consultation || ""}` === sig)) {
        p.schedule.push(slot);
      }
    }
  }
}

async function loadRppsAndGeocoded(): Promise<{ rpps: any[]; geo: any[] }> {
  const rppsPath = path.join(DATA_DIR, "rpps_hdf_paramedicaux.csv");
  const geoPath = path.join(DATA_DIR, "rpps_geocoded.csv");

  const rpps: any[] = [];
  {
    const stream = fs.createReadStream(rppsPath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let header: string[] | null = null;
    let lineNo = 0;
    for await (const rawLine of rl) {
      lineNo++;
      const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
      if (!header) {
        header = parseCSVLineSemi(line);
        continue;
      }
      if (!line.trim()) continue;
      const cols = parseCSVLineSemi(line);
      const r: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) r[header[i]] = cols[i] ?? "";
      rpps.push(r);
    }
  }
  const geo: any[] = [];
  {
    const stream = fs.createReadStream(geoPath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let header: string[] | null = null;
    let lineNo = 0;
    for await (const rawLine of rl) {
      lineNo++;
      const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
      if (!header) {
        header = parseCSVLineComma(line);
        continue;
      }
      if (!line.trim()) continue;
      const cols = parseCSVLineComma(line);
      const r: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) r[header[i]] = cols[i] ?? "";
      geo.push(r);
    }
  }
  return { rpps, geo };
}

interface CommuneAPL {
  code_insee: string;
  commune: string;
  population: number;
  apl_medecins: number | null;
  apl_infirmieres: number | null;
  apl_sages_femmes: number | null;
  apl_kine: number | null;
  apl_dentistes: number | null;
  quintile_medecins?: number;
  quintile_infirmieres?: number;
  quintile_sages_femmes?: number;
  quintile_kine?: number;
  quintile_dentistes?: number;
}

async function loadAPL(): Promise<Map<string, CommuneAPL>> {
  const aplPath = path.join(DATA_DIR, "apl_communes.csv");
  const out = new Map<string, CommuneAPL>();
  const stream = fs.createReadStream(aplPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header: string[] | null = null;
  let lineNo = 0;
  const parseNum = (s: string): number | null => {
    if (s == null || s === "" || s === "NA") return null;
    const v = parseFloat(s.replace(",", "."));
    return Number.isNaN(v) ? null : v;
  };
  for await (const rawLine of rl) {
    lineNo++;
    const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (!header) {
      header = parseCSVLineSemi(line);
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCSVLineSemi(line);
    const r: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) r[header[i]] = cols[i] ?? "";
    out.set(r.code_insee, {
      code_insee: r.code_insee,
      commune: r.commune,
      population: parseInt(r.population || "0", 10) || 0,
      apl_medecins: parseNum(r.apl_medecins),
      apl_infirmieres: parseNum(r.apl_infirmieres),
      apl_sages_femmes: parseNum(r.apl_sages_femmes),
      apl_kine: parseNum(r.apl_kine),
      apl_dentistes: parseNum(r.apl_dentistes),
    });
  }
  return out;
}

function computeQuintiles(communes: Map<string, CommuneAPL>): void {
  const keys: Array<keyof CommuneAPL> = [
    "apl_medecins",
    "apl_infirmieres",
    "apl_sages_femmes",
    "apl_kine",
    "apl_dentistes",
  ];
  const quintileKeys: Array<keyof CommuneAPL> = [
    "quintile_medecins",
    "quintile_infirmieres",
    "quintile_sages_femmes",
    "quintile_kine",
    "quintile_dentistes",
  ];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const qkey = quintileKeys[i];
    const vals: number[] = [];
    for (const c of communes.values()) {
      const v = c[key] as number | null;
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    // Compute 5 thresholds at 20%, 40%, 60%, 80%
    const thresholds = [0.2, 0.4, 0.6, 0.8].map((p) =>
      vals[Math.min(vals.length - 1, Math.floor(p * vals.length))],
    );
    for (const c of communes.values()) {
      const v = c[key] as number | null;
      if (v == null) {
        (c as any)[qkey] = null;
        continue;
      }
      let q = 5;
      if (v <= thresholds[0]) q = 1;
      else if (v <= thresholds[1]) q = 2;
      else if (v <= thresholds[2]) q = 3;
      else if (v <= thresholds[3]) q = 4;
      (c as any)[qkey] = q;
    }
  }
}

function computeScoreHorsRadar(p: any, commune: CommuneAPL | undefined): number {
  let score = 0;
  if (!p.telephone || String(p.telephone).trim() === "") score += 30;
  if (!p.schedule || p.schedule.length === 0) score += 20;

  // Under-supplied bonus
  const aplKey = aplKeyForProfession(p.profession);
  const qkey = ("quintile_" + aplKey) as keyof CommuneAPL;
  let quint: number | null = null;
  if (commune) {
    const v = (commune as any)[qkey];
    if (v != null) quint = v;
    else if ((commune as any).quintile_medecins != null) quint = (commune as any).quintile_medecins;
  }
  if (quint != null && quint <= 2) score += 25;

  if (p.convention === "Secteur 1") score += 15;

  // Mode libéral
  const mode = (p.mode_exercice || p.nature_exercice || "").toLowerCase();
  if (mode.includes("lib") || mode.includes("indép") || mode.includes("indep")) score += 10;

  return score;
}

async function main() {
  console.log(`[ingest-v2] DATA_DIR=${DATA_DIR}`);
  console.log(`[ingest-v2] DB_PATH=${DB_PATH}`);

  // ============ A. AMELI ============
  const practitioners = new Map<string, any>();
  for (const fname of AMELI_FILES) {
    const fp = path.join(DATA_DIR, fname);
    if (!fs.existsSync(fp)) {
      console.warn(`[ingest-v2] Missing ${fname}, skipping`);
      continue;
    }
    console.log(`[ingest-v2] Processing ${fname}...`);
    const before = practitioners.size;
    await processAmeliFile(fp, practitioners);
    console.log(`[ingest-v2]   +${practitioners.size - before} unique (total ${practitioners.size})`);
  }
  console.log(`[ingest-v2] Ameli unique: ${practitioners.size}`);

  // Build commune-INSEE → list of (lat, lon) from Ameli for fallback centroids
  const inseeCoords = new Map<string, { latSum: number; lonSum: number; n: number }>();
  for (const p of practitioners.values()) {
    if (p.code_commune && p.lat != null && p.lon != null) {
      const cc = p.code_commune;
      let agg = inseeCoords.get(cc);
      if (!agg) {
        agg = { latSum: 0, lonSum: 0, n: 0 };
        inseeCoords.set(cc, agg);
      }
      agg.latSum += p.lat;
      agg.lonSum += p.lon;
      agg.n++;
    }
  }

  // ============ B. RPPS ============
  console.log(`[ingest-v2] Loading RPPS + geocoded...`);
  const { rpps, geo } = await loadRppsAndGeocoded();
  console.log(`[ingest-v2] RPPS=${rpps.length} geo=${geo.length}`);
  if (rpps.length !== geo.length) {
    console.warn(`[ingest-v2] WARNING: rpps and geo row counts differ`);
  }
  let rppsAdded = 0;
  let rppsFallback = 0;
  let rppsDropped = 0;
  let rppsDedup = 0;
  const rppsSeen = new Set<string>();
  for (let i = 0; i < rpps.length; i++) {
    const r = rpps[i];
    const g = geo[i] || {};
    let lat: number | null = null,
      lon: number | null = null;
    const score = parseFloat(g.result_score || "0");
    if (!Number.isNaN(score) && score >= 0.5 && g.latitude && g.longitude) {
      lat = parseFloat(g.latitude);
      lon = parseFloat(g.longitude);
    } else {
      // Fallback: centroid of Ameli practitioners on same INSEE
      const cc = r.code_commune;
      const agg = cc ? inseeCoords.get(cc) : undefined;
      if (agg && agg.n > 0) {
        lat = agg.latSum / agg.n;
        lon = agg.lonSum / agg.n;
        rppsFallback++;
      } else {
        rppsDropped++;
        continue;
      }
    }
    const key = `RPPS|${r.rpps}|${r.code_postal}|${r.adresse}`;
    if (rppsSeen.has(key)) {
      rppsDedup++;
      continue;
    }
    rppsSeen.add(key);
    const dep = (r.code_postal || "").substring(0, 2);
    const depName: Record<string, string> = {
      "02": "Aisne",
      "59": "Nord",
      "60": "Oise",
      "62": "Pas-de-Calais",
      "80": "Somme",
    };
    const p = {
      source: "rpps",
      rpps: r.rpps,
      nom: [r.nom, r.prenom].filter(Boolean).join(" "),
      civilite: r.civilite,
      profession: r.profession,
      profession_normalized: slugify(r.profession),
      code_postal: r.code_postal,
      commune: r.commune,
      adresse_full: [r.raison_sociale, r.enseigne, r.adresse].filter(Boolean).join(" "),
      lat,
      lon,
      telephone: r.telephone || null,
      email: r.email || null,
      convention: "Non conventionné",
      mode_exercice: r.mode_exercice,
      nature_exercice: r.mode_exercice,
      secteur_activite: r.secteur_activite,
      genre_activite: r.genre_activite,
      sesam_vitale: 0,
      schedule: [] as any[],
      dep_name: depName[dep] || "",
      code_commune: r.code_commune,
    };
    practitioners.set(`rpps-${r.rpps}-${r.code_postal}-${i}`, p);
    rppsAdded++;
  }
  console.log(`[ingest-v2] RPPS added: ${rppsAdded}, fallback centroid: ${rppsFallback}, dropped: ${rppsDropped}, dedup: ${rppsDedup}`);

  // ============ C. APL ============
  console.log(`[ingest-v2] Loading APL...`);
  const communes = await loadAPL();
  console.log(`[ingest-v2] APL communes: ${communes.size}`);
  console.log(`[ingest-v2] Computing national quintiles...`);
  computeQuintiles(communes);

  // ============ D. Compute scores ============
  console.log(`[ingest-v2] Computing score_hors_radar...`);
  for (const p of practitioners.values()) {
    const c = p.code_commune ? communes.get(p.code_commune) : undefined;
    p.score_hors_radar = computeScoreHorsRadar(p, c);
    // also annotate quintile + apl_local for convenience
    const aplKey = aplKeyForProfession(p.profession);
    const aplVal = c ? (c as any)["apl_" + aplKey] : null;
    const aplFallback = c ? c.apl_medecins : null;
    p.apl_local = aplVal != null ? aplVal : aplFallback;
    const qkey = "quintile_" + aplKey;
    p.under_supplied = c
      ? (((c as any)[qkey] != null ? (c as any)[qkey] : c.quintile_medecins) ?? 99) <= 2
        ? 1
        : 0
      : 0;
  }

  // ============ E. Write DB ============
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    const walPath = DB_PATH + "-wal";
    const shmPath = DB_PATH + "-shm";
    if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
    if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE practitioners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT,
      rpps TEXT,
      nom TEXT NOT NULL,
      civilite TEXT,
      profession TEXT NOT NULL,
      profession_normalized TEXT NOT NULL,
      code_postal TEXT,
      commune TEXT,
      adresse_full TEXT,
      lat REAL,
      lon REAL,
      telephone TEXT,
      email TEXT,
      convention TEXT,
      mode_exercice TEXT,
      nature_exercice TEXT,
      secteur_activite TEXT,
      genre_activite TEXT,
      sesam_vitale INTEGER,
      schedule TEXT,
      dep_name TEXT,
      code_commune TEXT,
      score_hors_radar INTEGER DEFAULT 0,
      apl_local REAL,
      under_supplied INTEGER DEFAULT 0
    );
    CREATE INDEX idx_prof ON practitioners(profession_normalized);
    CREATE INDEX idx_cp ON practitioners(code_postal);
    CREATE INDEX idx_commune ON practitioners(commune);
    CREATE INDEX idx_geo ON practitioners(lat, lon);
    CREATE INDEX idx_score ON practitioners(score_hors_radar);
    CREATE INDEX idx_under ON practitioners(under_supplied);
    CREATE INDEX idx_code_commune ON practitioners(code_commune);

    CREATE TABLE communes (
      code_insee TEXT PRIMARY KEY,
      libelle TEXT,
      population INTEGER,
      apl_medecins REAL,
      apl_infirmieres REAL,
      apl_sages_femmes REAL,
      apl_kine REAL,
      apl_dentistes REAL,
      quintile_medecins INTEGER,
      quintile_infirmieres INTEGER,
      quintile_sages_femmes INTEGER,
      quintile_kine INTEGER,
      quintile_dentistes INTEGER,
      code_postal TEXT
    );
    CREATE INDEX idx_commune_cp ON communes(code_postal);
    CREATE INDEX idx_commune_lib ON communes(libelle);
  `);

  // Insert communes
  const insertC = db.prepare(`
    INSERT INTO communes (code_insee, libelle, population,
      apl_medecins, apl_infirmieres, apl_sages_femmes, apl_kine, apl_dentistes,
      quintile_medecins, quintile_infirmieres, quintile_sages_femmes, quintile_kine, quintile_dentistes,
      code_postal
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Build code_insee -> code_postal best-guess from practitioners
  const inseeToCp = new Map<string, string>();
  for (const p of practitioners.values()) {
    if (p.code_commune && p.code_postal && !inseeToCp.has(p.code_commune)) {
      inseeToCp.set(p.code_commune, p.code_postal);
    }
  }
  const insertManyC = db.transaction((rows: CommuneAPL[]) => {
    for (const c of rows) {
      insertC.run(
        c.code_insee,
        c.commune,
        c.population,
        c.apl_medecins,
        c.apl_infirmieres,
        c.apl_sages_femmes,
        c.apl_kine,
        c.apl_dentistes,
        (c as any).quintile_medecins ?? null,
        (c as any).quintile_infirmieres ?? null,
        (c as any).quintile_sages_femmes ?? null,
        (c as any).quintile_kine ?? null,
        (c as any).quintile_dentistes ?? null,
        inseeToCp.get(c.code_insee) ?? null,
      );
    }
  });
  insertManyC([...communes.values()]);
  console.log(`[ingest-v2] Inserted ${communes.size} communes`);

  // Insert practitioners
  const stmt = db.prepare(`
    INSERT INTO practitioners (
      source, rpps, nom, civilite, profession, profession_normalized, code_postal, commune,
      adresse_full, lat, lon, telephone, email, convention, mode_exercice, nature_exercice,
      secteur_activite, genre_activite, sesam_vitale, schedule, dep_name, code_commune,
      score_hors_radar, apl_local, under_supplied
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows: any[]) => {
    for (const p of rows) {
      stmt.run(
        p.source,
        p.rpps,
        p.nom,
        p.civilite,
        p.profession,
        p.profession_normalized,
        p.code_postal,
        p.commune,
        p.adresse_full,
        p.lat,
        p.lon,
        p.telephone,
        p.email,
        p.convention,
        p.mode_exercice,
        p.nature_exercice,
        p.secteur_activite,
        p.genre_activite,
        p.sesam_vitale,
        JSON.stringify(p.schedule || []),
        p.dep_name,
        p.code_commune,
        p.score_hors_radar || 0,
        p.apl_local,
        p.under_supplied || 0,
      );
    }
  });
  insertMany([...practitioners.values()]);

  // FTS5
  db.exec(`
    CREATE VIRTUAL TABLE practitioners_fts USING fts5(
      commune, adresse_full, nom, content='practitioners', content_rowid='id'
    );
    INSERT INTO practitioners_fts (rowid, commune, adresse_full, nom)
      SELECT id, commune, adresse_full, nom FROM practitioners;
  `);

  // Stats
  const total = db.prepare("SELECT COUNT(*) as c FROM practitioners").get() as { c: number };
  console.log(`\n[ingest-v2] === STATS ===`);
  console.log(`Total practitioners: ${total.c}`);
  const byDep = db.prepare("SELECT dep_name, COUNT(*) as c FROM practitioners GROUP BY dep_name ORDER BY c DESC").all();
  console.log("By department:");
  for (const r of byDep) console.log("  ", r);
  const bySrc = db.prepare("SELECT source, COUNT(*) as c FROM practitioners GROUP BY source").all();
  console.log("By source:");
  for (const r of bySrc) console.log("  ", r);
  const topProf = db.prepare("SELECT profession, COUNT(*) as c FROM practitioners GROUP BY profession ORDER BY c DESC LIMIT 20").all();
  console.log("Top 20 professions:");
  for (const r of topProf) console.log("  ", r);
  const hr = db.prepare("SELECT COUNT(*) as c FROM practitioners WHERE score_hors_radar >= 50").get() as { c: number };
  console.log(`score_hors_radar >= 50: ${hr.c}`);
  const us = db.prepare("SELECT COUNT(*) as c FROM communes WHERE quintile_medecins <= 2").get() as { c: number };
  console.log(`Communes quintile_medecins <= 2 (national): ${us.c}`);
  const usHdf = db.prepare("SELECT COUNT(DISTINCT code_commune) as c FROM practitioners p JOIN communes c ON p.code_commune = c.code_insee WHERE p.under_supplied = 1").get() as { c: number };
  console.log(`HDF communes flagged under_supplied (with practitioners): ${usHdf.c}`);

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
