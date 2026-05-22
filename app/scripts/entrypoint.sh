#!/usr/bin/env bash
#
# Entrypoint Docker — télécharge data.db.gz depuis la dernière GitHub Release
# si elle n'est pas déjà présente dans le volume persistant /data, puis démarre
# le serveur Node.
#

set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
DB_PATH="${DATA_DIR}/data.db"
RELEASE_URL="${DB_RELEASE_URL:-https://github.com/JETPOD/trouve-praticien/releases/latest/download/data.db.gz}"

mkdir -p "$DATA_DIR"

# Création/refresh de la DB
if [[ ! -f "$DB_PATH" ]] || [[ "${FORCE_DB_REFRESH:-0}" = "1" ]]; then
  echo "[entrypoint] Téléchargement de data.db.gz depuis $RELEASE_URL…"
  tmp_gz="$(mktemp --suffix=.gz)"
  if ! curl -fSL --retry 5 --retry-delay 3 -o "$tmp_gz" "$RELEASE_URL"; then
    echo "[entrypoint] ❌ Échec du téléchargement de data.db.gz"
    rm -f "$tmp_gz"
    exit 1
  fi
  echo "[entrypoint] Décompression…"
  gunzip -c "$tmp_gz" > "${DB_PATH}.tmp"
  mv "${DB_PATH}.tmp" "$DB_PATH"
  rm -f "$tmp_gz"
  echo "[entrypoint] ✅ data.db prête ($(du -h "$DB_PATH" | cut -f1))"
else
  echo "[entrypoint] data.db déjà présente ($(du -h "$DB_PATH" | cut -f1)), pas de re-téléchargement"
fi

# Lien symbolique pour que le code utilise /app/data.db comme avant
ln -sf "$DB_PATH" /app/data.db

# Lancement du serveur
exec "$@"
