import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "../data");
const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "data.db");

interface RawRow {
  civilite: string;
  nom: string;
  libelle_profession: string;
  adresse3: string;
  adresse4: string;
  code_postal: string;
  telephone: string;
  code_profession: string;
  exercice_particulier: string;
  nature_exercice: string;
  convention: string;
  sesam_vitale: string;
  type_activite: string;
  type_consultation: string;
  heure_debut: string;
  heure_fin: string;
  jour: string;
  adresse: string;
  coordonnees: string;
  dep_name: string;
  reg_name: string;
  code_commune: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseCSVLine(line: string): string[] {
  // Simple CSV split by ';', no quoting in this dataset
  return line.split(";");
}

function timeOnly(iso: string): string {
  if (!iso) return "";
  // "0001-01-01T08:30:00+00:00" -> "08:30"
  const m = iso.match(/T(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return iso;
}

function extractCommune(adresse: string, code_postal: string): string {
  if (!adresse) return "";
  // Heuristic: last token after CP in adresse field
  // "CABINET ... 24 AVENUE ... 62200 BOULOGNE SUR MER" -> "BOULOGNE SUR MER"
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

async function processFile(
  filePath: string,
  practitioners: Map<string, any>,
): Promise<void> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let lineNo = 0;
  for await (const rawLine of rl) {
    lineNo++;
    // Strip BOM on first line
    const line = lineNo === 1 ? rawLine.replace(/^\uFEFF/, "") : rawLine;
    if (!header) {
      header = parseCSVLine(line);
      continue;
    }
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    if (cols.length < header.length) continue;
    const row: any = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cols[i] ?? "";
    const r = row as RawRow;

    const key = [r.nom, r.code_postal, r.libelle_profession, r.adresse].join("|");
    let p = practitioners.get(key);
    if (!p) {
      let lat: number | null = null,
        lon: number | null = null;
      if (r.coordonnees) {
        const parts = r.coordonnees.split(",").map((s) => s.trim());
        if (parts.length === 2) {
          const la = parseFloat(parts[0]);
          const lo = parseFloat(parts[1]);
          if (!Number.isNaN(la) && !Number.isNaN(lo)) {
            lat = la;
            lon = lo;
          }
        }
      }
      const convention =
        r.convention?.toLowerCase().includes("non") ? "Non conventionné" :
        r.convention?.toLowerCase().includes("secteur 1") ? "Secteur 1" :
        r.convention?.toLowerCase().includes("secteur 2") ? "Secteur 2" :
        r.convention || "";
      p = {
        nom: r.nom,
        civilite: r.civilite,
        profession: r.libelle_profession,
        profession_normalized: slugify(r.libelle_profession),
        code_postal: r.code_postal,
        commune: extractCommune(r.adresse, r.code_postal),
        adresse_full: r.adresse,
        lat,
        lon,
        telephone: r.telephone || null,
        convention,
        nature_exercice: r.nature_exercice,
        sesam_vitale: r.sesam_vitale?.toLowerCase().includes("sesam") ? 1 : 0,
        schedule: [],
        dep_name: r.dep_name,
        code_commune: r.code_commune,
      };
      practitioners.set(key, p);
    }
    // Append schedule slot if there's a real horaire
    if (r.jour && r.heure_debut && r.heure_fin) {
      const slot = {
        jour: JOUR_MAP[r.jour] || r.jour,
        heure_debut: timeOnly(r.heure_debut),
        heure_fin: timeOnly(r.heure_fin),
        type_consultation: r.type_consultation || undefined,
      };
      // dedupe identical slot
      const sig = `${slot.jour}|${slot.heure_debut}|${slot.heure_fin}|${slot.type_consultation || ""}`;
      if (!p.schedule.some((s: any) =>
        `${s.jour}|${s.heure_debut}|${s.heure_fin}|${s.type_consultation || ""}` === sig)) {
        p.schedule.push(slot);
      }
    }
  }
}

async function main() {
  const files = ["sample_62.csv", "sample_59.csv"]
    .map((f) => path.join(DATA_DIR, f))
    .filter((f) => fs.existsSync(f));

  console.log(`[ingest] Reading from: ${files.join(", ")}`);
  const practitioners = new Map<string, any>();

  for (const f of files) {
    console.log(`[ingest] Processing ${path.basename(f)}...`);
    await processFile(f, practitioners);
    console.log(`[ingest] After ${path.basename(f)}: ${practitioners.size} unique practitioners`);
  }

  console.log(`[ingest] Total unique: ${practitioners.size}`);

  // Remove old db
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
      convention TEXT,
      nature_exercice TEXT,
      sesam_vitale INTEGER,
      schedule TEXT,
      dep_name TEXT,
      code_commune TEXT
    );
    CREATE INDEX idx_prof ON practitioners(profession_normalized);
    CREATE INDEX idx_cp ON practitioners(code_postal);
    CREATE INDEX idx_commune ON practitioners(commune);
    CREATE INDEX idx_geo ON practitioners(lat, lon);
  `);

  const stmt = db.prepare(`
    INSERT INTO practitioners (
      nom, civilite, profession, profession_normalized, code_postal, commune,
      adresse_full, lat, lon, telephone, convention, nature_exercice,
      sesam_vitale, schedule, dep_name, code_commune
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: any[]) => {
    for (const p of rows) {
      stmt.run(
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
        p.convention,
        p.nature_exercice,
        p.sesam_vitale,
        JSON.stringify(p.schedule),
        p.dep_name,
        p.code_commune,
      );
    }
  });

  insertMany([...practitioners.values()]);
  const total = db.prepare("SELECT COUNT(*) as c FROM practitioners").get() as { c: number };
  console.log(`[ingest] Inserted ${total.c} practitioners into ${DB_PATH}`);

  // Top 10 professions
  const top = db
    .prepare(
      "SELECT profession, COUNT(*) as count FROM practitioners GROUP BY profession ORDER BY count DESC LIMIT 15",
    )
    .all();
  console.log("[ingest] Top professions:");
  for (const row of top) console.log("  -", row);

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
