# Trouve ton praticien

> Outil de recherche de praticiens **vraiment disponibles** en France métropolitaine — annuaire Ameli + RPPS + densité APL DREES.
> Aucune évaluation, aucune publicité, score « hors-radar » pour aider à trouver les professionnels disponibles que les moteurs grand public ne mettent pas en avant.

Projet réalisé par [NutricellScience](https://nutricellscience.blog) · Dr Jean-Étienne Podik

---

## 🎯 Objectif

Beaucoup de spécialistes (dermatologues, pédiatres, orthophonistes…) sont débordés et difficiles à trouver disponibles via Google ou Doctolib. Cet outil agrège les sources publiques pour faire émerger les profils **réellement disponibles** mais peu visibles en ligne, et signaler les **zones sous-dotées**.

## 📊 Données

- **515 801 praticiens** géolocalisés en France métropolitaine
- **501 241** depuis l'annuaire Ameli (CNAM, Licence Ouverte)
- **14 560** paramédicaux (psychologues, ostéos, ergos, psychomotriciens…) depuis le **RPPS** pour les Hauts-de-France
- **34 954 communes** avec densité **APL DREES** (médecins, infirmiers, kinés, sages-femmes, dentistes)
- **184 137 praticiens** avec score hors-radar ≥ 50
- **48 016 praticiens** en zone sous-dotée (quintile APL ≤ 2)

## 🧮 Score hors-radar

Précalculé à l'ingestion à partir de signaux publics :

| Critère | Points |
|---|---|
| Pas de téléphone publié | +30 |
| Pas d'horaires publiés | +20 |
| Commune en zone sous-dotée (quintile APL ≤ 2) | +25 |
| Convention Secteur 1 | +15 |
| Mode d'exercice libéral | +10 |

Le score révèle des praticiens en exercice mais peu référencés par les moteurs grand public — typiquement de jeunes installations ou des cabinets sans présence numérique active.

Voir [`METHODOLOGY.md`](./METHODOLOGY.md) pour les détails complets.

## 🚀 Stack technique

- **Backend** : Node.js + Express + better-sqlite3 + Drizzle ORM
- **Frontend** : React + Vite + Tailwind CSS + shadcn/ui + Leaflet (avec MarkerCluster)
- **Base** : SQLite avec FTS5 (recherche full-text), index spatiaux
- **Pipeline** : Scripts TypeScript d'ingestion + géocodage via [API BAN](https://api-adresse.data.gouv.fr/)

## 📂 Structure du repo

```
trouve-praticien/
├── app/                    # Application Express + React
│   ├── client/             # Frontend Vite/React
│   ├── server/             # API Express
│   ├── shared/             # Schémas Drizzle partagés
│   └── scripts/            # Pipeline d'ingestion (Ameli, RPPS, APL, géocodage)
├── data/                   # CSV sources (via Git LFS, gzippés)
│   ├── national/           # 90 CSV départementaux Ameli
│   ├── apl/                # Fichiers DREES APL (médecins, IDE, kinés…)
│   └── *.csv.gz            # Sources HDF + RPPS paramédicaux
├── .github/workflows/      # CI : rebuild de data.db
├── METHODOLOGY.md          # Méthodologie scientifique détaillée
└── README.md
```

## 🛠️ Installation locale

```bash
git lfs install
git clone https://github.com/<votre-user>/trouve-praticien.git
cd trouve-praticien

# 1. Installation
cd app && npm ci

# 2. Décompression des sources et reconstruction de la base
cd .. && bash scripts/build-db.sh

# 3. Lancement du serveur de dev
cd app && npm run dev
```

Le frontend est accessible sur http://localhost:5000 après `npm run dev`.

## 🔄 Rebuild automatique

Le workflow `.github/workflows/build-db.yml` reconstruit `data.db` à chaque push sur `main` et publie une release avec la base SQLite prête à l'emploi. Un cron mensuel peut être ajouté pour rafraîchir les sources Ameli/RPPS automatiquement.

## 🌐 Démo

> *(À renseigner après publication finale — sous-domaine `trouve-praticien.pplx.app` ou hébergeur externe)*

## 📜 Licence

- **Code** : [MIT](./LICENSE)
- **Données** : Licence Ouverte 2.0 (Etalab) — voir [LICENSE](./LICENSE)

## 🙏 Crédits

Sources de données :

- [Annuaire des professionnels de santé (CNAM)](https://public.opendatasoft.com/explore/dataset/annuaire-des-professionnels-de-sante/)
- [Annuaire Santé RPPS (ANS)](https://www.data.gouv.fr/datasets/annuaire-sante-extractions-des-donnees-en-libre-acces-des-professionnels-intervenant-dans-le-systeme-de-sante/)
- [Accessibilité Potentielle Localisée (DREES)](https://www.data.gouv.fr/datasets/laccessibilite-potentielle-localisee-apl/)
- [Base Adresse Nationale (data.gouv.fr)](https://adresse.data.gouv.fr/)

## 📬 Contact

Dr Jean-Étienne Podik — [NutricellScience](https://nutricellscience.blog)
Médecin de Santé publique · RPPS 10100722742 · Liévin (62), France
