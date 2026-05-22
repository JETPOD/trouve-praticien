# syntax=docker/dockerfile:1.6
#
# Image de production "Trouve ton praticien"
# - Build du backend Node + frontend (frontend non servi en prod chez OVH,
#   mais on garde le build pour le mode monolithique / fallback)
# - data.db téléchargée depuis la dernière GitHub Release au runtime
#   (volume monté sur /data, ré-utilisée entre redémarrages)
#

############################
# Stage 1 — Builder
############################
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 nécessite python3 + build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

############################
# Stage 2 — Runtime
############################
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Outils runtime: curl pour télécharger la DB, ca-certificates pour HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gzip \
    && rm -rf /var/lib/apt/lists/*

# Production dependencies uniquement
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# Artefacts du build
COPY --from=builder /app/dist ./dist
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Volume Fly.io monté ici (persistance entre redémarrages)
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# entrypoint télécharge la dernière data.db.gz si absente, puis lance le serveur
ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/index.cjs"]
