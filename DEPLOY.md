# Guide de déploiement

> Architecture cible : **frontend statique sur OVH** (`trouve-praticien.nutricellscience.com`) + **backend Node/SQLite sur Fly.io** (`trouve-praticien-api.fly.dev`).

```
                ┌──────────────────────────────────────┐
                │      Visiteur (navigateur)           │
                └──────────────┬───────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
            ▼                                     ▼
  HTML/JS/CSS statiques               Appels API (CORS)
  trouve-praticien                    trouve-praticien-api
  .nutricellscience.com               .fly.dev
  (Hébergement OVH                   (Fly.io
   mutualisé, FTP)                    Docker + volume
                                       SQLite 335 MB)
```

## Vue d'ensemble

À chaque push sur `main`, GitHub Actions :
1. **`build-db.yml`** — reconstruit `data.db` (~515 k praticiens), publie une release GitHub avec `data.db.gz`
2. **`deploy-backend.yml`** — déploie le backend sur Fly.io. Au démarrage, le container télécharge `data.db.gz` depuis la release et la pose sur un volume persistant
3. **`deploy-frontend-ovh.yml`** — build le frontend Vite avec `VITE_API_URL=https://trouve-praticien-api.fly.dev`, puis pousse `dist/public/` sur OVH via FTP

## Phase 1 — Backend Fly.io

### 1.1. Créer le compte Fly.io

1. Aller sur https://fly.io/app/sign-up
2. Créer un compte (carte bancaire demandée pour vérification, mais tu restes dans le free tier)
3. Installer le CLI flyctl localement (Mac) :
   ```bash
   brew install flyctl
   flyctl auth login
   ```

### 1.2. Créer l'application Fly.io

Depuis la racine `app/` :

```bash
cd app
flyctl launch --no-deploy --name trouve-praticien-api --region cdg
```

⚠️ Réponds **non** à toutes les questions sauf le nom et la région. Le `fly.toml` est déjà fourni — `flyctl` peut juste t'écraser des champs, garde la version du repo.

### 1.3. Créer le volume persistant

```bash
flyctl volumes create trouve_praticien_data --size 1 --region cdg
```

1 GB suffit largement (data.db = 335 MB).

### 1.4. Premier déploiement manuel

```bash
flyctl deploy --remote-only
```

Suivre les logs : tu dois voir l'entrypoint télécharger `data.db.gz` puis le serveur démarrer.

### 1.5. Récupérer le token API pour GitHub Actions

```bash
flyctl tokens create deploy -x 720h
```

Copie le token affiché.

Puis sur GitHub :
- https://github.com/JETPOD/trouve-praticien/settings/secrets/actions
- New repository secret → Name: `FLY_API_TOKEN` → Value: *le token copié*

### 1.6. Test de l'API

```bash
curl https://trouve-praticien-api.fly.dev/api/stats
# Doit renvoyer: {"total":515801,"horsRadar":184137,"underSupplied":...}
```

## Phase 2 — Frontend OVH

### 2.1. Créer le sous-domaine côté OVH

1. Console OVH → Web Cloud → Domaines → `nutricellscience.com`
2. Onglet "Sous-domaines" → Ajouter `trouve-praticien.nutricellscience.com`
3. Le diriger vers le même hébergement que `nutricellscience.com`
4. Créer un dossier dédié : connexion FTP → créer `www/trouve-praticien/`
5. Espace OVH → Multisite → Pointer le sous-domaine `trouve-praticien.nutricellscience.com` vers `www/trouve-praticien/`

### 2.2. Récupérer les credentials FTP OVH

Console OVH → Web Cloud → Hébergement → FTP-SSH :
- Host : `ftp.cluster121.hosting.ovh.net` (ou ton cluster)
- User : `nuqfzmu` (ton login FTP, à confirmer dans la console)
- Password : celui que tu as configuré

### 2.3. Ajouter les secrets/variables GitHub

Sur https://github.com/JETPOD/trouve-praticien/settings :

**Secrets** (Settings → Secrets and variables → Actions → Secrets) :
| Nom | Valeur |
|---|---|
| `OVH_FTP_HOST` | `ftp.cluster121.hosting.ovh.net` |
| `OVH_FTP_USER` | ton login FTP OVH |
| `OVH_FTP_PASSWORD` | mot de passe FTP OVH |

**Variables** (Settings → Secrets and variables → Actions → Variables) :
| Nom | Valeur |
|---|---|
| `OVH_REMOTE_DIR` | `/www/trouve-praticien/` |
| `VITE_API_URL` | `https://trouve-praticien-api.fly.dev` |

### 2.4. Premier déploiement frontend

Soit :
- Pousser un commit sur `main` qui touche `app/client/**`
- Soit déclencher manuellement le workflow `Build & deploy frontend to OVH` depuis l'onglet Actions

Vérifier ensuite : ouvrir `https://trouve-praticien.nutricellscience.com` dans le navigateur. Le frontend doit s'afficher et appeler le backend Fly.io.

## Phase 3 — DNS et HTTPS

### 3.1. DNS

Le sous-domaine OVH est géré automatiquement par OVH (zone DNS du domaine). Aucune action manuelle nécessaire.

### 3.2. HTTPS

- **OVH** : SSL Let's Encrypt automatique sur les hébergements mutualisés (activer "SSL" dans la console multisite si pas déjà fait).
- **Fly.io** : HTTPS auto sur `*.fly.dev`. Si tu veux un sous-domaine custom (`api.trouve-praticien.nutricellscience.com`), ajouter un certificat :
  ```bash
  flyctl certs add api.trouve-praticien.nutricellscience.com
  ```
  Puis créer un CNAME dans OVH : `api.trouve-praticien` → `trouve-praticien-api.fly.dev`

## Maintenance

### Rebuild manuel de data.db

```bash
gh workflow run build-db.yml --repo JETPOD/trouve-praticien
```

Ou attendre le cron mensuel (1er du mois 03:00 UTC).

### Forcer le backend Fly.io à recharger data.db après nouvelle release

```bash
flyctl ssh console -a trouve-praticien-api
# Dans le container :
rm /data/data.db
exit
flyctl machine restart -a trouve-praticien-api
```

Ou plus simple : redéployer via push.

### Logs en production

```bash
# Backend Fly.io
flyctl logs -a trouve-praticien-api

# Frontend OVH (pas de logs serveur, c'est du statique)
# Utiliser les outils devtools du navigateur
```

## Coûts estimés

| Service | Free tier | Au-delà |
|---|---|---|
| Hébergement OVH | déjà payé | déjà payé |
| Fly.io (1 vCPU, 1 GB RAM, 1 GB volume) | ~0 €/mois si auto-stop activé | ~3 €/mois si toujours actif |
| Domaine nutricellscience.com | déjà payé | — |

**Total marginal : 0 € à 3 €/mois.**
