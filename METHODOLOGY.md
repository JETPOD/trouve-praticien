# Méthodologie

Ce document décrit la méthodologie d'agrégation, de géocodage et de scoring utilisée par "Trouve ton praticien". Il vise la transparence et la reproductibilité scientifique : tout le pipeline est dans le repo et peut être rejoué à l'identique.

## 1. Sources de données

### 1.1 Annuaire Ameli (CNAM)

**Provider** : Caisse Nationale de l'Assurance Maladie via OpenDataSoft
**URL** : https://public.opendatasoft.com/explore/dataset/annuaire-des-professionnels-de-sante/
**Licence** : [Licence Ouverte 2.0 (Etalab)](https://www.etalab.gouv.fr/licence-ouverte-open-licence/)

Couverture : **professionnels libéraux conventionnés** par l'Assurance Maladie. Une ligne = un créneau horaire publié pour un praticien à une adresse donnée. La déduplication par (nom, adresse, profession) reconstruit ~250 000 praticiens uniques pour la France métropolitaine.

**Champs utilisés** :
- `nom`, `civilite`, `libelle_profession`
- `adresse`, `code_postal`, `dep_name`, `code_commune`
- `telephone`, `coordonnees` (lat/lon)
- `convention`, `nature_exercice`, `sesam_vitale`
- `jour`, `heure_debut`, `heure_fin`, `type_consultation`

### 1.2 RPPS (Annuaire Santé ANS)

**Provider** : Agence du Numérique en Santé
**URL** : https://www.data.gouv.fr/datasets/annuaire-sante-extractions-des-donnees-en-libre-acces-des-professionnels-intervenant-dans-le-systeme-de-sante/
**Licence** : Licence Ouverte 2.0

Couverture utilisée dans cette version : **paramédicaux non-Ameli** pour les Hauts-de-France uniquement (psychologues, ostéopathes, ergothérapeutes, psychomotriciens, diététiciens, psychothérapeutes, chiropracteurs). Total : **14 560 praticiens**.

Le RPPS national représente ~200 000 lignes supplémentaires : son intégration est prévue dans une itération ultérieure.

### 1.3 APL DREES

**Provider** : Direction de la Recherche, des Études, de l'Évaluation et des Statistiques
**URL** : https://www.data.gouv.fr/datasets/laccessibilite-potentielle-localisee-apl/
**Licence** : Licence Ouverte 2.0

L'**Accessibilité Potentielle Localisée** mesure pour chaque commune l'adéquation entre offre et besoin de soins, exprimée en consultations par habitant et par an. Disponible pour 5 professions :

| Profession | Fichier |
|---|---|
| Médecins généralistes | `APL_communes_medecins.xlsx` |
| Infirmiers | `APL_communes_infirmiers.xlsx` |
| Kinésithérapeutes | `APL_communes_kine.xlsx` |
| Sages-femmes | `APL_communes_sages_femmes.xlsx` |
| Chirurgiens-dentistes | `APL_communes_dentistes.xlsx` |

**Zone sous-dotée** : nous classons une commune comme "sous-dotée" pour une profession donnée si elle se situe dans le **quintile APL ≤ 2** (les 40 % les moins bien desservies).

### 1.4 Base Adresse Nationale (BAN)

**Provider** : data.gouv.fr / IGN / La Poste
**URL** : https://api-adresse.data.gouv.fr/
**Licence** : ODbL 1.0 / Licence Ouverte selon usage

Utilisée pour le **géocodage batch** des praticiens RPPS qui n'ont pas de coordonnées (les Ameli ont déjà des `coordonnees`). Taux de succès observé : **73,6 %** sur les 14 560 lignes RPPS HDF. Les 3 834 cas non géocodés exactement sont rattrapés par le **centroïde de la commune** (basé sur le code INSEE), 13 lignes restent exclues.

## 2. Pipeline d'ingestion

### 2.1 Vue d'ensemble

```
CSV bruts (Ameli + RPPS)          DREES (xlsx)            BAN API
        │                              │                     │
        ▼                              ▼                     ▼
[parse + dédoublonnage]      [extraction APL]      [géocodage batch]
        │                              │                     │
        └──────────┬───────────────────┘                     │
                   ▼                                         ▼
            [enrichissement APL par commune] ◄────────────────
                   │
                   ▼
            [calcul score hors-radar v2]
                   │
                   ▼
            INSERT batch (5 000 lignes/chunk) dans SQLite + FTS5
```

### 2.2 Déduplication

Clé naturelle : `(nom_normalisé, adresse_normalisée, profession_normalisée)`. Les doublons inter-sources (RPPS + Ameli sur même praticien) sont fusionnés en gardant Ameli prioritaire pour les horaires et RPPS prioritaire pour l'identité.

### 2.3 Géocodage

- **Ameli** : champ `coordonnees` natif (lat;lon)
- **RPPS** : adresse pleine envoyée à l'API BAN en batch CSV (`/search/csv/`) avec :
  - colonne `adresse_complete` = `adresse + code_postal + commune`
  - filtre `result_score >= 0.5` pour éviter les fausses correspondances
- **Fallback** : centroïde commune via base INSEE (`code_commune`)
- **Exclusion** : si pas de lat/lon final, le praticien est exclu de la base

### 2.4 Score hors-radar v2

Score précalculé à l'ingestion (pas en runtime) pour permettre l'indexation et le tri rapide.

```typescript
score = 0
if (!telephone)                     score += 30
if (!horaires?.length)              score += 20
if (commune.apl_quintile <= 2)      score += 25
if (convention === 'Secteur 1')     score += 15
if (mode_exercice === 'Libéral')    score += 10
```

**Interprétation** :
- **0–24** : praticien bien référencé, horaires et téléphone publiés en zone correctement dotée
- **25–49** : profil modérément discret
- **50–74** : profil hors-radar (mérite l'attention de l'usager)
- **75–100** : très hors-radar — typiquement nouveau praticien sans présence numérique, en zone sous-dotée

## 3. Limites et biais connus

### 3.1 Biais de couverture

- **Paramédicaux hors HDF** : non couverts (psychologues, ergos, psychomotriciens) — retour 0 résultat hors Hauts-de-France
- **Praticiens non conventionnés** : absents d'Ameli (ex: certains psychiatres en secteur 3, cliniques privées non conventionnées)
- **Hôpitaux et CH** : seuls les libéraux sont listés ; les praticiens hospitaliers exclusifs n'apparaissent pas

### 3.2 Biais temporel

Les CSV Ameli sont rafraîchis trimestriellement par la CNAM, le RPPS mensuellement par l'ANS. Notre base reflète la dernière extraction au moment du build. Un cron mensuel est prévu pour réingérer automatiquement.

### 3.3 Score hors-radar — limites

Le score ne mesure **pas** la qualité ou la disponibilité réelle. Il mesure des **signaux indirects** corrélés avec une faible visibilité numérique :
- Un praticien peut être "hors-radar" mais surchargé localement
- Un praticien avec téléphone et horaires publics peut quand même avoir des disponibilités
- L'APL est calculé sur la commune de résidence du patient, pas sur celle du praticien

L'outil reste un **complément** aux moteurs grand public, pas un substitut à un appel direct ou à un rendez-vous via Doctolib.

## 4. Reproductibilité

Toute la chaîne est exécutable :

```bash
bash scripts/build-db.sh
```

Ce script :
1. Décompresse les CSV gzippés depuis `data/`
2. Lance `app/scripts/ingest-national.ts` (recompile la DB from scratch)
3. Vérifie les compteurs finaux

Le workflow `.github/workflows/build-db.yml` reproduit ces étapes dans un environnement propre Ubuntu + Node 20 + SQLite, publie un artefact `data.db` et le joint à une GitHub Release.

## 5. Contact scientifique

Pour signaler une erreur méthodologique ou suggérer une amélioration : ouvrez une issue GitHub ou contactez le mainteneur via [NutricellScience](https://nutricellscience.blog).
