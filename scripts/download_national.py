#!/usr/bin/env python3
"""Téléchargement parallèle des CSV départementaux depuis OpenDataSoft."""
import os
import sys
import time
import urllib.parse
import urllib.request
import concurrent.futures as cf
from pathlib import Path

OUT_DIR = Path("/home/user/workspace/trouve-praticien/data/national")
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Départements métropolitains. Exclus HDF (déjà téléchargés): Nord, Pas-de-Calais, Aisne, Oise, Somme
DEPARTMENTS = [
    "Ain", "Allier", "Alpes-de-Haute-Provence", "Hautes-Alpes", "Alpes-Maritimes",
    "Ardèche", "Ardennes", "Ariège", "Aube", "Aude", "Aveyron",
    "Bouches-du-Rhône", "Calvados", "Cantal", "Charente", "Charente-Maritime",
    "Cher", "Corrèze", "Corse-du-Sud", "Haute-Corse", "Côte-d'Or", "Côtes-d'Armor",
    "Creuse", "Dordogne", "Doubs", "Drôme", "Eure", "Eure-et-Loir", "Finistère",
    "Gard", "Haute-Garonne", "Gers", "Gironde", "Hérault", "Ille-et-Vilaine",
    "Indre", "Indre-et-Loire", "Isère", "Jura", "Landes", "Loir-et-Cher",
    "Loire", "Haute-Loire", "Loire-Atlantique", "Loiret", "Lot", "Lot-et-Garonne",
    "Lozère", "Maine-et-Loire", "Manche", "Marne", "Haute-Marne", "Mayenne",
    "Meurthe-et-Moselle", "Meuse", "Morbihan", "Moselle", "Nièvre", "Orne",
    "Paris", "Pyrénées-Atlantiques", "Hautes-Pyrénées", "Pyrénées-Orientales",
    "Bas-Rhin", "Haut-Rhin", "Rhône", "Haute-Saône", "Saône-et-Loire", "Sarthe",
    "Savoie", "Haute-Savoie", "Seine-Maritime", "Seine-et-Marne", "Yvelines",
    "Deux-Sèvres", "Tarn", "Tarn-et-Garonne", "Var", "Vaucluse", "Vendée",
    "Vienne", "Haute-Vienne", "Vosges", "Yonne", "Territoire de Belfort",
    "Essonne", "Hauts-de-Seine", "Seine-Saint-Denis", "Val-de-Marne", "Val-d'Oise",
]


def slug_for_filename(name: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", name)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("'", "_").replace(" ", "_")
    return s


def build_url(dep: str) -> str:
    base = "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/annuaire-des-professionnels-de-sante/exports/csv"
    params = {
        "lang": "fr",
        "timezone": "Europe/Paris",
        "use_labels": "true",
        "delimiter": ";",
        "refine": f'dep_name:"{dep}"',
    }
    return f"{base}?{urllib.parse.urlencode(params)}"


def is_complete(path: Path) -> bool:
    """A complete CSV from ODS ends with a newline and is not pathological size."""
    try:
        sz = path.stat().st_size
        if sz < 5000:
            return False
        with open(path, "rb") as f:
            f.seek(-2, 2)
            tail = f.read(2)
        return tail.endswith(b"\n")
    except Exception:
        return False


def download(dep: str, retry: int = 4) -> tuple[str, int, str]:
    out = OUT_DIR / f"ameli_{slug_for_filename(dep)}.csv"
    if out.exists() and is_complete(out):
        try:
            with open(out, "rb") as f:
                n = sum(1 for _ in f)
            return (dep, n, "cached")
        except Exception:
            pass
    elif out.exists():
        out.unlink()
    url = build_url(dep)
    last_err = ""
    for attempt in range(retry):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "trouve-praticien/2.0"})
            with urllib.request.urlopen(req, timeout=300) as r, open(out, "wb") as f:
                while True:
                    chunk = r.read(1024 * 64)
                    if not chunk:
                        break
                    f.write(chunk)
            with open(out, "rb") as f:
                n = sum(1 for _ in f)
            return (dep, n, "ok")
        except Exception as e:
            last_err = repr(e)
            time.sleep(2 + attempt * 3)
    return (dep, 0, f"FAIL: {last_err}")


def main():
    print(f"Téléchargement de {len(DEPARTMENTS)} départements vers {OUT_DIR}")
    results = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(download, d): d for d in DEPARTMENTS}
        done = 0
        for fut in cf.as_completed(futures):
            dep, n, status = fut.result()
            done += 1
            print(f"[{done}/{len(DEPARTMENTS)}] {dep}: {n} lignes ({status})", flush=True)
            results.append((dep, n, status))
    print("\n=== Résumé ===")
    total = 0
    fails = []
    for dep, n, status in results:
        total += n
        if "FAIL" in status:
            fails.append((dep, status))
    print(f"Total lignes (toutes deps): {total}")
    if fails:
        print(f"Échecs: {len(fails)}")
        for d, s in fails:
            print(f"  - {d}: {s}")
    else:
        print("Tous les départements téléchargés avec succès.")


if __name__ == "__main__":
    main()
