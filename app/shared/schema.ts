import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const practitioners = sqliteTable(
  "practitioners",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source"),
    rpps: text("rpps"),
    nom: text("nom").notNull(),
    civilite: text("civilite"),
    profession: text("profession").notNull(),
    profession_normalized: text("profession_normalized").notNull(),
    code_postal: text("code_postal"),
    commune: text("commune"),
    adresse_full: text("adresse_full"),
    lat: real("lat"),
    lon: real("lon"),
    telephone: text("telephone"),
    email: text("email"),
    convention: text("convention"),
    mode_exercice: text("mode_exercice"),
    nature_exercice: text("nature_exercice"),
    secteur_activite: text("secteur_activite"),
    genre_activite: text("genre_activite"),
    sesam_vitale: integer("sesam_vitale"),
    schedule: text("schedule"), // JSON
    dep_name: text("dep_name"),
    code_commune: text("code_commune"),
    score_hors_radar: integer("score_hors_radar"),
    apl_local: real("apl_local"),
    under_supplied: integer("under_supplied"),
  },
  (t) => ({
    profIdx: index("idx_prof").on(t.profession_normalized),
    cpIdx: index("idx_cp").on(t.code_postal),
    communeIdx: index("idx_commune").on(t.commune),
    geoIdx: index("idx_geo").on(t.lat, t.lon),
    scoreIdx: index("idx_score").on(t.score_hors_radar),
    underIdx: index("idx_under").on(t.under_supplied),
  }),
);

export const communes = sqliteTable("communes", {
  code_insee: text("code_insee").primaryKey(),
  libelle: text("libelle"),
  population: integer("population"),
  apl_medecins: real("apl_medecins"),
  apl_infirmieres: real("apl_infirmieres"),
  apl_sages_femmes: real("apl_sages_femmes"),
  apl_kine: real("apl_kine"),
  apl_dentistes: real("apl_dentistes"),
  quintile_medecins: integer("quintile_medecins"),
  quintile_infirmieres: integer("quintile_infirmieres"),
  quintile_sages_femmes: integer("quintile_sages_femmes"),
  quintile_kine: integer("quintile_kine"),
  quintile_dentistes: integer("quintile_dentistes"),
  code_postal: text("code_postal"),
});

export const insertPractitionerSchema = createInsertSchema(practitioners).omit({
  id: true,
});

export type InsertPractitioner = z.infer<typeof insertPractitionerSchema>;
export type Practitioner = typeof practitioners.$inferSelect;
export type Commune = typeof communes.$inferSelect;

export interface ScheduleSlot {
  jour: string;
  heure_debut: string;
  heure_fin: string;
  type_consultation?: string;
}
