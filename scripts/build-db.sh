#!/usr/bin/env bash
#
# Reconstruit data.db from scratch à partir des CSV gzippés stockés via Git LFS.
# Idempotent : peut être relancé sans risque.
#
# Usage:
#   bash scripts/build-db.sh
#
# Pré-requis:
#   - git-lfs installé (`git lfs install` après clone)
#   - node 20+
#   - npm install dans app/

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app"
DATA_DIR="$ROOT_DIR/data"

echo "==> Trouve ton praticien — Build DB"
echo "    Root:    $ROOT_DIR"
echo "    Data:    $DATA_DIR"
echo "    App:     $APP_DIR"
echo ""

# 1. Vérification LFS
if ! command -v git-lfs >/dev/null 2>&1; then
  echo "❌ git-lfs n'est pas installé. Installez-le puis relancez :"
  echo "   sudo apt install git-lfs && git lfs install && git lfs pull"
  exit 1
fi

# 2. Décompression des CSV
echo "==> Décompression des CSV gzippés…"
shopt -s nullglob
gz_count=0
for gz in "$DATA_DIR"/*.csv.gz "$DATA_DIR"/national/*.csv.gz; do
  target="${gz%.gz}"
  if [[ ! -f "$target" || "$gz" -nt "$target" ]]; then
    gunzip -kf "$gz"
    gz_count=$((gz_count + 1))
  fi
done
echo "    $gz_count fichier(s) décompressé(s)"
echo ""

# 3. Vérification présence des CSV critiques
required=(
  "$DATA_DIR/apl_communes.csv"
  "$DATA_DIR/rpps_geocoded.csv"
  "$DATA_DIR/sample_59.csv"
  "$DATA_DIR/sample_62.csv"
)
for f in "${required[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ Fichier requis manquant : $f"
    echo "   Avez-vous lancé 'git lfs pull' ?"
    exit 1
  fi
done

national_count=$(ls "$DATA_DIR"/national/ameli_*.csv 2>/dev/null | wc -l)
echo "==> $national_count CSV départementaux nationaux détectés"
if [[ $national_count -lt 80 ]]; then
  echo "⚠️  Moins de 80 départements présents — vérifiez que git lfs pull a bien tout récupéré"
fi
echo ""

# 4. Suppression DB existante pour repartir from scratch
if [[ -f "$APP_DIR/data.db" ]]; then
  echo "==> Suppression de data.db existant…"
  rm -f "$APP_DIR/data.db" "$APP_DIR/data.db-shm" "$APP_DIR/data.db-wal"
fi

# 5. Lancement de l'ingestion
echo "==> Lancement de l'ingestion (peut prendre 2-5 min)…"
cd "$APP_DIR"
npm run ingest:national

# 6. Vérification finale
if [[ -f "$APP_DIR/data.db" ]]; then
  db_size=$(du -h "$APP_DIR/data.db" | cut -f1)
  echo ""
  echo "✅ data.db reconstruite avec succès ($db_size)"
  echo "   → $APP_DIR/data.db"
else
  echo "❌ data.db non trouvée après ingestion"
  exit 1
fi
