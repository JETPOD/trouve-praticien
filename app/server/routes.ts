import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = path.resolve(process.cwd(), "data.db");
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma("journal_mode = WAL");

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function aplKeyForProfession(prof: string): "medecins" | "infirmieres" | "sages_femmes" | "kine" | "dentistes" {
  const s = slugify(prof);
  if (s.includes("infirmier")) return "infirmieres";
  if (s.includes("sage-femme") || s.includes("sage-femmes")) return "sages_femmes";
  if (s.includes("kinesith") || s.includes("masseur-kine") || s.includes("kinesitherapeute")) return "kine";
  if (s.includes("dentiste") || s.includes("chirurgien-dentiste")) return "dentistes";
  return "medecins";
}

interface PractitionerRow {
  id: number;
  source: string | null;
  rpps: string | null;
  nom: string;
  civilite: string | null;
  profession: string;
  profession_normalized: string;
  code_postal: string | null;
  commune: string | null;
  adresse_full: string | null;
  lat: number | null;
  lon: number | null;
  telephone: string | null;
  email: string | null;
  convention: string | null;
  mode_exercice: string | null;
  nature_exercice: string | null;
  secteur_activite: string | null;
  genre_activite: string | null;
  sesam_vitale: number;
  schedule: string | null;
  dep_name: string | null;
  code_commune: string | null;
  score_hors_radar: number;
  apl_local: number | null;
  under_supplied: number;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // GET /api/professions
  app.get("/api/professions", (_req: Request, res: Response) => {
    const rows = db
      .prepare(
        `SELECT profession, profession_normalized, COUNT(*) as count
         FROM practitioners
         GROUP BY profession_normalized
         ORDER BY count DESC`,
      )
      .all();
    res.json(rows);
  });

  // GET /api/communes?q=...  (uses communes table for HDF deps when q given,
  // otherwise top-population HDF communes with practitioners)
  app.get("/api/communes", (req: Request, res: Response) => {
    const q = String(req.query.q || "").trim().toUpperCase();
    if (!q || q.length < 2) {
      const rows = db
        .prepare(
          `SELECT commune, code_postal, COUNT(*) as count
           FROM practitioners
           WHERE commune IS NOT NULL AND commune != ''
           GROUP BY commune, code_postal
           ORDER BY count DESC
           LIMIT 20`,
        )
        .all();
      res.json(rows);
      return;
    }
    const like = `${q}%`;
    const rows = db
      .prepare(
        `SELECT commune, code_postal, COUNT(*) as count
         FROM practitioners
         WHERE UPPER(commune) LIKE ? OR code_postal LIKE ?
         GROUP BY commune, code_postal
         ORDER BY count DESC
         LIMIT 30`,
      )
      .all(like, like);
    res.json(rows);
  });

  // GET /api/commune/:insee -> detail with APL + quintiles
  app.get("/api/commune/:insee", (req: Request, res: Response) => {
    const insee = String(req.params.insee || "").trim();
    if (!insee) {
      res.status(400).json({ error: "Missing insee" });
      return;
    }
    const row: any = db
      .prepare(
        `SELECT code_insee, libelle, population,
          apl_medecins, apl_infirmieres, apl_sages_femmes, apl_kine, apl_dentistes,
          quintile_medecins, quintile_infirmieres, quintile_sages_femmes, quintile_kine, quintile_dentistes,
          code_postal
         FROM communes WHERE code_insee = ?`,
      )
      .get(insee);
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  });

  /**
   * Build WHERE clause + geo params from query.
   * Returns:
   *  - whereSql, params for the SQL prepared statement
   *  - hasGeoRadius (bool) and lat/lon/radius for haversine filter
   */
  function buildSearchWhere(req: Request) {
    const profession = String(req.query.profession || "").trim();
    const code_postal = String(req.query.code_postal || "").trim();
    const commune = String(req.query.commune || "").trim();
    const latParam = req.query.lat ? parseFloat(String(req.query.lat)) : NaN;
    const lonParam = req.query.lon ? parseFloat(String(req.query.lon)) : NaN;
    const radius_km = req.query.radius_km
      ? parseFloat(String(req.query.radius_km))
      : 0;
    const secteur = String(req.query.secteur || "all");
    const under_supplied = String(req.query.under_supplied || "") === "true";

    const where: string[] = [];
    const params: any[] = [];

    if (profession) {
      const slug = slugify(profession);
      where.push("(profession_normalized = ? OR profession = ?)");
      params.push(slug, profession);
    }
    const hasGeoRadius =
      !Number.isNaN(latParam) && !Number.isNaN(lonParam) && radius_km > 0;
    if (!hasGeoRadius) {
      if (code_postal) {
        where.push("code_postal = ?");
        params.push(code_postal);
      }
      if (commune && !code_postal) {
        where.push("UPPER(commune) LIKE ?");
        params.push(`${commune.toUpperCase()}%`);
      }
    }
    if (secteur === "1") where.push("convention = 'Secteur 1'");
    else if (secteur === "2") where.push("convention = 'Secteur 2'");
    if (under_supplied) where.push("under_supplied = 1");

    if (hasGeoRadius) {
      const dLat = radius_km / 111;
      const dLon = radius_km / (111 * Math.cos((latParam * Math.PI) / 180) || 1);
      where.push("lat BETWEEN ? AND ?");
      params.push(latParam - dLat, latParam + dLat);
      where.push("lon BETWEEN ? AND ?");
      params.push(lonParam - dLon, lonParam + dLon);
    }

    return {
      whereSql: where.length ? "WHERE " + where.join(" AND ") : "",
      params,
      hasGeoRadius,
      latParam,
      lonParam,
      radius_km,
    };
  }

  // GET /api/search
  // Pagination serveur. Params: page (1-based), limit (default 50, max 200).
  // La carte reçoit les bounds calculés sur tous les résultats (pas seulement la page).
  app.get("/api/search", (req: Request, res: Response) => {
    const sort = String(req.query.sort || "distance");
    const page = Math.max(parseInt(String(req.query.page || "1"), 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1),
      200,
    );

    const { whereSql, params, hasGeoRadius, latParam, lonParam, radius_km } =
      buildSearchWhere(req);

    // Cap raw fetch — France-wide queries without filters could match millions of rows
    // 20000 is plenty for any realistic per-commune/per-radius search
    const rawRows = db
      .prepare(`SELECT * FROM practitioners ${whereSql} LIMIT 20000`)
      .all(...params) as PractitionerRow[];

    let enriched = rawRows.map((r) => {
      const distance =
        hasGeoRadius && r.lat != null && r.lon != null
          ? haversine(latParam, lonParam, r.lat, r.lon)
          : null;
      return { ...r, distance };
    });

    if (hasGeoRadius) {
      enriched = enriched.filter(
        (r) => r.distance !== null && (r.distance as number) <= radius_km,
      );
    }

    if (sort === "hors_radar") {
      enriched.sort((a, b) => {
        if (b.score_hors_radar !== a.score_hors_radar)
          return b.score_hors_radar - a.score_hors_radar;
        if (a.distance != null && b.distance != null) return a.distance - b.distance;
        return 0;
      });
    } else {
      enriched.sort((a, b) => {
        if (a.distance == null && b.distance == null) return 0;
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      });
    }

    const total = enriched.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, pages);
    const start = (safePage - 1) * limit;
    const pageRows = enriched.slice(start, start + limit);

    const enrichRow = (r: typeof enriched[number]) => {
      let scheduleParsed: any[] = [];
      try {
        scheduleParsed = r.schedule ? JSON.parse(r.schedule) : [];
      } catch {}
      const isProfilDiscret =
        (!r.telephone || r.telephone.trim() === "") && scheduleParsed.length === 0;
      return {
        ...r,
        schedule: scheduleParsed,
        sesam_vitale: !!r.sesam_vitale,
        under_supplied: !!r.under_supplied,
        profil_discret: isProfilDiscret,
        hors_radar: isProfilDiscret,
        apl_profession: aplKeyForProfession(r.profession),
      };
    };

    const results = pageRows.map(enrichRow);

    // Bounds calculés sur TOUS les résultats (pas juste la page)
    let bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null = null;
    const geoAll = enriched.filter((r) => r.lat != null && r.lon != null);
    if (geoAll.length > 0) {
      let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      for (const r of geoAll) {
        const la = r.lat as number;
        const lo = r.lon as number;
        if (la < minLat) minLat = la;
        if (la > maxLat) maxLat = la;
        if (lo < minLon) minLon = lo;
        if (lo > maxLon) maxLon = lo;
      }
      bounds = { minLat, maxLat, minLon, maxLon };
    }

    res.json({
      total,
      page: safePage,
      pages,
      limit,
      shown: results.length,
      bounds,
      results,
    });
  });

  // GET /api/map-points
  // Returns lightweight {id,lat,lon,profession,under_supplied,profil_discret} for ALL matches.
  // Used by the map clustering layer — must NOT be paginated.
  app.get("/api/map-points", (req: Request, res: Response) => {
    const { whereSql, params, hasGeoRadius, latParam, lonParam, radius_km } =
      buildSearchWhere(req);
    // Hard cap to protect memory; if exceeded, the map can be downsampled on the client
    const MAX_POINTS = 30000;
    const geoClause = whereSql
      ? whereSql + " AND lat IS NOT NULL AND lon IS NOT NULL"
      : "WHERE lat IS NOT NULL AND lon IS NOT NULL";
    const rows = db
      .prepare(
        `SELECT id, lat, lon, nom, profession, telephone, schedule, under_supplied,
                code_commune
         FROM practitioners ${geoClause}
         LIMIT 60000`,
      )
      .all(...params) as any[];
    let filtered = rows;
    if (hasGeoRadius) {
      filtered = rows.filter((r) => {
        const d = haversine(latParam, lonParam, r.lat, r.lon);
        return d <= radius_km;
      });
    }
    const truncated = filtered.length > MAX_POINTS;
    const slice = filtered.slice(0, MAX_POINTS).map((r) => {
      let scheduleParsed: any[] = [];
      try {
        scheduleParsed = r.schedule ? JSON.parse(r.schedule) : [];
      } catch {}
      const profil_discret =
        (!r.telephone || r.telephone.trim() === "") && scheduleParsed.length === 0;
      return {
        id: r.id,
        lat: r.lat,
        lon: r.lon,
        nom: r.nom,
        profession: r.profession,
        under_supplied: !!r.under_supplied,
        profil_discret,
      };
    });
    res.json({
      total: filtered.length,
      truncated,
      points: slice,
    });
  });

  // Geocode helper: lookup commune/CP centroid from our db
  app.get("/api/geocode", (req: Request, res: Response) => {
    const code_postal = String(req.query.code_postal || "").trim();
    const commune = String(req.query.commune || "").trim();
    let row: any;
    if (code_postal) {
      row = db
        .prepare(
          `SELECT AVG(lat) as lat, AVG(lon) as lon, commune, code_postal
           FROM practitioners
           WHERE code_postal = ? AND lat IS NOT NULL`,
        )
        .get(code_postal);
    } else if (commune) {
      row = db
        .prepare(
          `SELECT AVG(lat) as lat, AVG(lon) as lon, commune, code_postal
           FROM practitioners
           WHERE UPPER(commune) LIKE ? AND lat IS NOT NULL`,
        )
        .get(`${commune.toUpperCase()}%`);
    }
    if (!row || row.lat == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  });

  // GET /api/stats — minimal counts for hero
  app.get("/api/stats", (_req: Request, res: Response) => {
    const total = (db.prepare("SELECT COUNT(*) as c FROM practitioners").get() as any).c;
    const horsRadar = (db.prepare("SELECT COUNT(*) as c FROM practitioners WHERE score_hors_radar >= 50").get() as any).c;
    const underSupplied = (db
      .prepare(
        `SELECT COUNT(DISTINCT code_commune) as c FROM practitioners
         WHERE under_supplied = 1 AND code_commune IS NOT NULL`,
      )
      .get() as any).c;
    res.json({ total, horsRadar, underSupplied });
  });

  return httpServer;
}
