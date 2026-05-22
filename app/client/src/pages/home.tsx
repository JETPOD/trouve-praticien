import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  MapPin,
  Phone,
  Search,
  Sun,
  Moon,
  ChevronDown,
  Check,
  ChevronsUpDown,
  Stethoscope,
  Sparkles,
  AlertTriangle,
  Database as DbIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";
import { NutricellLogo } from "@/components/logo";
import { apiRequest } from "@/lib/queryClient";
import L from "leaflet";
import "leaflet.markercluster";
import {
  MapContainer,
  TileLayer,
  useMap,
} from "react-leaflet";

// Centre par défaut : France métropolitaine
const HDF_CENTER: [number, number] = [46.6, 2.5];

interface Profession {
  profession: string;
  profession_normalized: string;
  count: number;
}

interface Commune {
  commune: string;
  code_postal: string;
  count: number;
}

interface Practitioner {
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
  sesam_vitale: boolean;
  schedule: { jour: string; heure_debut: string; heure_fin: string; type_consultation?: string }[];
  dep_name: string | null;
  code_commune: string | null;
  distance: number | null;
  score_hors_radar: number;
  apl_local: number | null;
  apl_profession: string;
  under_supplied: boolean;
  profil_discret: boolean;
  hors_radar: boolean;
}

interface SearchResponse {
  total: number;
  page: number;
  pages: number;
  limit: number;
  shown: number;
  bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number } | null;
  results: Practitioner[];
}

interface MapPoint {
  id: number;
  lat: number;
  lon: number;
  nom: string;
  profession: string;
  under_supplied: boolean;
  profil_discret: boolean;
}

interface MapPointsResponse {
  total: number;
  truncated: boolean;
  points: MapPoint[];
}

interface CommuneDetail {
  code_insee: string;
  libelle: string;
  population: number;
  apl_medecins: number | null;
  apl_infirmieres: number | null;
  apl_sages_femmes: number | null;
  apl_kine: number | null;
  apl_dentistes: number | null;
  quintile_medecins: number | null;
  quintile_infirmieres: number | null;
  quintile_sages_femmes: number | null;
  quintile_kine: number | null;
  quintile_dentistes: number | null;
  code_postal: string | null;
}

interface Stats {
  total: number;
  horsRadar: number;
  underSupplied: number;
}

const standardIcon = L.divIcon({
  className: "custom-marker-wrapper",
  html: '<span class="custom-marker"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});
const horsRadarIcon = L.divIcon({
  className: "custom-marker-wrapper",
  html: '<span class="custom-marker hors-radar"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});
const underSuppliedIcon = L.divIcon({
  className: "custom-marker-wrapper",
  html: '<span class="custom-marker under-supplied"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22],
});

function MapAutoFit({
  bounds,
  center,
}: {
  bounds: SearchResponse["bounds"];
  center: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(
        [
          [bounds.minLat, bounds.minLon],
          [bounds.maxLat, bounds.maxLon],
        ],
        { padding: [40, 40], maxZoom: 13 },
      );
    } else if (center) {
      map.setView(center, 12);
    }
  }, [bounds, center, map]);
  return null;
}

function MapFlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.flyTo(target, 15, { duration: 0.6 });
    }
  }, [target, map]);
  return null;
}

// Cluster layer driven by lightweight map-points. Uses imperative Leaflet API.
function MapClusterLayer({ points }: { points: MapPoint[] }) {
  const map = useMap();
  useEffect(() => {
    // @ts-ignore - markercluster augments L at runtime
    const cluster = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      disableClusteringAtZoom: 14,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
    });
    for (const p of points) {
      const icon = p.under_supplied
        ? underSuppliedIcon
        : p.profil_discret
          ? horsRadarIcon
          : standardIcon;
      const m = L.marker([p.lat, p.lon], { icon });
      const safe = (s: string) =>
        s.replace(/[&<>"']/g, (c) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c] as string);
      m.bindPopup(
        `<div class="text-sm">
          <div class="font-semibold">${safe(p.nom)}</div>
          <div class="text-xs" style="color:#6b7280">${safe(p.profession)}</div>
        </div>`,
        { minWidth: 200 },
      );
      cluster.addLayer(m);
    }
    map.addLayer(cluster);
    return () => {
      map.removeLayer(cluster);
    };
  }, [map, points]);
  return null;
}

function ResultsPagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  const go = (p: number) => onChange(Math.min(Math.max(1, p), pages));
  // Build a compact list: first, last, current±2, with ellipses
  const wanted = new Set<number>([1, pages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((n) => wanted.add(n));
  const nums = Array.from(wanted)
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const items: (number | "…")[] = [];
  for (let i = 0; i < nums.length; i++) {
    items.push(nums[i]);
    if (i + 1 < nums.length && nums[i + 1] - nums[i] > 1) items.push("…");
  }
  return (
    <div
      className="flex items-center justify-center gap-1 pt-3 pb-1 flex-wrap"
      data-testid="pagination"
    >
      <button
        type="button"
        className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={page <= 1}
        onClick={() => go(page - 1)}
        data-testid="button-page-prev"
      >
        ← Précédent
      </button>
      {items.map((it, i) =>
        it === "…" ? (
          <span key={`e${i}`} className="px-1.5 text-xs text-muted-foreground">
            …
          </span>
        ) : (
          <button
            key={it}
            type="button"
            onClick={() => go(it as number)}
            className={cn(
              "min-w-[2rem] px-2 py-1 text-xs rounded-md border",
              it === page
                ? "bg-emerald-600 text-white border-emerald-600"
                : "border-border hover:bg-accent",
            )}
            data-testid={`button-page-${it}`}
          >
            {it}
          </button>
        ),
      )}
      <button
        type="button"
        className="px-2.5 py-1 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={page >= pages}
        onClick={() => go(page + 1)}
        data-testid="button-page-next"
      >
        Suivant →
      </button>
    </div>
  );
}

function ConventionBadge({ convention }: { convention: string | null }) {
  if (!convention) return null;
  if (convention === "Secteur 1") {
    return (
      <Badge
        className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border-emerald-300/50 hover:bg-emerald-100"
        data-testid="badge-secteur-1"
      >
        Secteur 1
      </Badge>
    );
  }
  if (convention === "Secteur 2") {
    return (
      <Badge
        className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-300/50 hover:bg-amber-100"
        data-testid="badge-secteur-2"
      >
        Secteur 2
      </Badge>
    );
  }
  if (convention === "Non conventionné") {
    return (
      <Badge
        className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300/50 hover:bg-slate-200"
        data-testid="badge-non-conventionne"
      >
        Non conventionné
      </Badge>
    );
  }
  return <Badge variant="outline">{convention}</Badge>;
}

function aplLabel(q: number | null): { label: string; color: string } {
  if (q == null) return { label: "Non renseigné", color: "text-muted-foreground" };
  if (q <= 2) return { label: "Sous-dotée", color: "text-rose-700 dark:text-rose-300" };
  if (q === 3) return { label: "Moyenne", color: "text-amber-700 dark:text-amber-300" };
  return { label: "Bien dotée", color: "text-emerald-700 dark:text-emerald-300" };
}

function AplBar({ quintile, label }: { quintile: number | null; label: string }) {
  const q = quintile ?? 0;
  const meta = aplLabel(quintile);
  const colorClass =
    q <= 2 ? "bg-rose-500" : q === 3 ? "bg-amber-500" : q >= 4 ? "bg-emerald-500" : "bg-muted";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 flex gap-0.5 h-1.5 rounded overflow-hidden bg-muted">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              "flex-1 transition-colors",
              quintile != null && i <= q ? colorClass : "bg-transparent",
            )}
          />
        ))}
      </div>
      <span className={cn("w-20 shrink-0 text-right font-medium", meta.color)}>
        {meta.label}
      </span>
    </div>
  );
}

function CommuneInfoPanel({ insee }: { insee: string | null }) {
  const { data, isLoading } = useQuery<CommuneDetail>({
    queryKey: ["/api/commune", insee],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/commune/${insee}`);
      return res.json();
    },
    enabled: !!insee,
  });
  if (!insee) return null;
  if (isLoading)
    return <div className="text-xs text-muted-foreground">Chargement…</div>;
  if (!data) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-sm">{data.libelle}</div>
        <div className="text-xs text-muted-foreground">
          {data.population?.toLocaleString("fr")} hab.
        </div>
      </div>
      <div className="space-y-1 pt-1">
        <AplBar quintile={data.quintile_medecins} label="Médecins" />
        <AplBar quintile={data.quintile_infirmieres} label="Infirmiers" />
        <AplBar quintile={data.quintile_kine} label="Kinés" />
        <AplBar quintile={data.quintile_dentistes} label="Dentistes" />
        <AplBar quintile={data.quintile_sages_femmes} label="Sages-femmes" />
      </div>
      <p className="text-[10px] text-muted-foreground pt-1">
        APL : Accessibilité Potentielle Localisée — DREES
      </p>
    </div>
  );
}

function PractitionerCard({
  p,
  onLocate,
}: {
  p: Practitioner;
  onLocate: () => void;
}) {
  const [openSched, setOpenSched] = useState(false);
  const display = `${p.civilite === "Homme" || p.civilite === "Monsieur" ? "Dr" : p.civilite === "Femme" || p.civilite === "Madame" ? "Dr" : ""} ${p.nom}`.trim();
  return (
    <Card
      className="p-4 flex flex-col gap-2"
      data-testid={`card-practitioner-${p.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3
            className="font-semibold text-base leading-tight"
            data-testid={`text-name-${p.id}`}
          >
            {display}
          </h3>
          <div className="mt-1 flex flex-wrap gap-1.5 items-center">
            <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white border-emerald-700">
              {p.profession}
            </Badge>
            <ConventionBadge convention={p.convention} />
            {p.under_supplied && (
              <Badge
                className="bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 border-rose-300/50 hover:bg-rose-100"
                data-testid={`badge-under-supplied-${p.id}`}
              >
                <AlertTriangle className="w-3 h-3 mr-1" />
                Zone sous-dotée
              </Badge>
            )}
            {p.profil_discret && (
              <Badge
                variant="outline"
                className="border-slate-400/60 text-slate-700 dark:text-slate-300"
                data-testid={`badge-profil-discret-${p.id}`}
              >
                <Sparkles className="w-3 h-3 mr-1" />
                Profil discret
              </Badge>
            )}
            {p.source === "rpps" && (
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                RPPS
              </Badge>
            )}
            {p.sesam_vitale && (
              <Badge variant="outline" className="text-xs">
                Carte Vitale
              </Badge>
            )}
          </div>
        </div>
        <div className="text-right shrink-0 space-y-0.5">
          {p.distance !== null && (
            <div
              className="text-xs text-muted-foreground whitespace-nowrap"
              data-testid={`text-distance-${p.id}`}
            >
              {p.distance.toFixed(1)} km
            </div>
          )}
          {p.score_hors_radar > 0 && (
            <div
              className="text-[10px] text-muted-foreground whitespace-nowrap"
              data-testid={`text-score-${p.id}`}
              title="Score hors-radar (0-100)"
            >
              score {p.score_hors_radar}
            </div>
          )}
        </div>
      </div>
      <div className="text-sm text-muted-foreground flex items-start gap-2">
        <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
        <span data-testid={`text-address-${p.id}`}>{p.adresse_full}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {p.telephone ? (
          <a
            href={`tel:${p.telephone.replace(/\s+/g, "")}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
            data-testid={`link-phone-${p.id}`}
          >
            <Phone className="w-4 h-4" />
            {p.telephone}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground italic">Téléphone non renseigné</span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onLocate}
          className="ml-auto"
          data-testid={`button-locate-${p.id}`}
        >
          <MapPin className="w-3.5 h-3.5 mr-1" />
          Voir sur la carte
        </Button>
      </div>
      {p.schedule.length > 0 && (
        <Collapsible open={openSched} onOpenChange={setOpenSched}>
          <CollapsibleTrigger asChild>
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              data-testid={`button-schedule-${p.id}`}
            >
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform",
                  openSched && "rotate-180",
                )}
              />
              Horaires ({p.schedule.length})
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 text-xs text-muted-foreground grid grid-cols-2 gap-1">
              {p.schedule.map((s, i) => (
                <li key={i} className="font-mono">
                  <span className="font-medium">{s.jour}</span> {s.heure_debut}–
                  {s.heure_fin}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function ProfessionCombobox({
  professions,
  value,
  onChange,
}: {
  professions: Profession[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = professions.find((p) => p.profession_normalized === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          data-testid="button-profession"
        >
          <span className="truncate">
            {selected ? selected.profession : "Toutes professions"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Chercher une profession..." data-testid="input-profession-search" />
          <CommandList className="max-h-72">
            <CommandEmpty>Aucune profession trouvée.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value=""
                onSelect={() => {
                  onChange("");
                  setOpen(false);
                }}
                data-testid="item-profession-all"
              >
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                Toutes professions
              </CommandItem>
              {professions.map((p) => (
                <CommandItem
                  key={p.profession_normalized}
                  value={`${p.profession} ${p.profession_normalized}`}
                  onSelect={() => {
                    onChange(p.profession_normalized);
                    setOpen(false);
                  }}
                  data-testid={`item-profession-${p.profession_normalized}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === p.profession_normalized ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1">{p.profession}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {p.count.toLocaleString("fr")}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CommuneInput({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: Commune) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery<Commune[]>({
    queryKey: ["/api/communes", value],
    queryFn: async () => {
      const url = `/api/communes${value ? `?q=${encodeURIComponent(value)}` : ""}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
    enabled: open,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Commune ou code postal"
            className="pl-9"
            data-testid="input-commune"
          />
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[300px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-72 overflow-auto py-1">
          {data && data.length > 0 ? (
            data.map((c, i) => (
              <button
                key={`${c.commune}-${c.code_postal}-${i}`}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between"
                data-testid={`item-commune-${c.code_postal}`}
              >
                <span>
                  <span className="font-medium">{c.commune}</span>
                  <span className="ml-2 text-muted-foreground">{c.code_postal}</span>
                </span>
                <span className="text-xs text-muted-foreground">{c.count}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Tapez 2 caractères ou plus...
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Home() {
  const { theme, toggle } = useTheme();

  // Search state
  const [profession, setProfession] = useState("");
  const [communeText, setCommuneText] = useState("");
  const [codePostal, setCodePostal] = useState("");
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [radius, setRadius] = useState(20);
  const [secteur1Only, setSecteur1Only] = useState(false);
  const [underSuppliedOnly, setUnderSuppliedOnly] = useState(false);
  const [sort, setSort] = useState<"distance" | "hors_radar">("distance");
  const [searchTrigger, setSearchTrigger] = useState(0);
  const [mapFlyTarget, setMapFlyTarget] = useState<[number, number] | null>(null);
  const [openInsee, setOpenInsee] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data: professions } = useQuery<Profession[]>({
    queryKey: ["/api/professions"],
  });
  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/stats"],
  });

  const searchParams = useMemo(() => {
    if (searchTrigger === 0) return null;
    const p = new URLSearchParams();
    if (profession) p.set("profession", profession);
    if (codePostal) p.set("code_postal", codePostal);
    else if (communeText) p.set("commune", communeText);
    if (center) {
      p.set("lat", String(center[0]));
      p.set("lon", String(center[1]));
      p.set("radius_km", String(radius));
    }
    if (secteur1Only) p.set("secteur", "1");
    if (underSuppliedOnly) p.set("under_supplied", "true");
    p.set("sort", sort);
    return p.toString();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Build the paginated /api/search URL (limit=50, page state)
  const PAGE_SIZE = 50;
  const pagedSearch = searchParams
    ? `${searchParams}&page=${page}&limit=${PAGE_SIZE}`
    : "";

  const { data: results, isLoading } = useQuery<SearchResponse>({
    queryKey: ["/api/search", pagedSearch],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/search?${pagedSearch}`);
      return res.json();
    },
    enabled: !!pagedSearch,
  });

  // Map points query — fetches ALL filtered points (no pagination)
  // depends only on searchParams (not page) so doesn't refetch on page change
  const { data: mapPoints } = useQuery<MapPointsResponse>({
    queryKey: ["/api/map-points", searchParams],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/map-points?${searchParams}`);
      return res.json();
    },
    enabled: !!searchParams,
  });

  const onSelectCommune = async (c: Commune) => {
    setCommuneText(c.commune);
    setCodePostal(c.code_postal);
    try {
      const res = await apiRequest("GET", `/api/geocode?code_postal=${c.code_postal}`);
      const g = await res.json();
      if (g.lat && g.lon) setCenter([g.lat, g.lon]);
    } catch {}
  };

  const onSearch = async () => {
    if (communeText && !center) {
      try {
        const res = await apiRequest(
          "GET",
          `/api/geocode?${codePostal ? `code_postal=${codePostal}` : `commune=${encodeURIComponent(communeText)}`}`,
        );
        const g = await res.json();
        if (g.lat && g.lon) setCenter([g.lat, g.lon]);
      } catch {}
    }
    setPage(1);
    setSearchTrigger((n) => n + 1);
  };

  const handleLocate = (p: Practitioner) => {
    if (p.lat != null && p.lon != null) {
      setMapFlyTarget([p.lat, p.lon]);
      const mapEl = document.getElementById("map-container");
      if (mapEl) mapEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const totalDisplay = stats?.total ?? 250000;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="text-emerald-600 dark:text-emerald-400">
              <NutricellLogo className="w-8 h-8" />
            </div>
            <div className="leading-tight">
              <h1 className="font-semibold text-lg tracking-tight" data-testid="text-site-title">
                Trouve ton praticien
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                France métropolitaine · Outil NutricellScience
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Basculer le thème"
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-2">
          <p className="text-sm text-muted-foreground">
            Trouvez un praticien <span className="text-foreground font-medium">vraiment disponible</span> en
            France métropolitaine. Annuaire Ameli + RPPS + densité APL — pas d'évaluations, pas de pub.
          </p>
        </div>
      </header>

      {/* Search bar */}
      <section className="border-b border-border bg-muted/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-4">
              <Label className="text-xs mb-1 block">Profession</Label>
              <ProfessionCombobox
                professions={professions || []}
                value={profession}
                onChange={setProfession}
              />
            </div>
            <div className="md:col-span-3">
              <Label className="text-xs mb-1 block">Où</Label>
              <CommuneInput
                value={communeText}
                onChange={(v) => {
                  setCommuneText(v);
                  setCodePostal("");
                  setCenter(null);
                }}
                onSelect={onSelectCommune}
              />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs mb-1 block" data-testid="label-radius">
                Rayon: {radius} km
              </Label>
              <Slider
                value={[radius]}
                onValueChange={(v) => setRadius(v[0])}
                min={5}
                max={50}
                step={5}
                data-testid="slider-radius"
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="secteur1" className="text-xs">
                  Secteur 1
                </Label>
                <Switch
                  id="secteur1"
                  checked={secteur1Only}
                  onCheckedChange={setSecteur1Only}
                  data-testid="switch-secteur-1"
                />
              </div>
              <div className="flex gap-1 rounded-md border border-input p-0.5 bg-background">
                <button
                  className={cn(
                    "flex-1 text-xs px-1.5 py-1 rounded",
                    sort === "distance"
                      ? "bg-emerald-600 text-white"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                  onClick={() => setSort("distance")}
                  data-testid="button-sort-distance"
                >
                  Plus proche
                </button>
                <button
                  className={cn(
                    "flex-1 text-xs px-1.5 py-1 rounded",
                    sort === "hors_radar"
                      ? "bg-emerald-600 text-white"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                  onClick={() => setSort("hors_radar")}
                  data-testid="button-sort-hors-radar"
                >
                  Hors-radar
                </button>
              </div>
            </div>
            <div className="md:col-span-1">
              <Button
                onClick={onSearch}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="button-search"
              >
                <Search className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Chercher</span>
              </Button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Checkbox
              id="under-supplied"
              checked={underSuppliedOnly}
              onCheckedChange={(c) => setUnderSuppliedOnly(c === true)}
              data-testid="checkbox-under-supplied"
            />
            <Label htmlFor="under-supplied" className="text-xs cursor-pointer flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
              Uniquement zones sous-dotées (quintile APL ≤ 2)
            </Label>
          </div>
        </div>
      </section>

      {/* Results layout */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:h-[calc(100vh-260px)]">
          {/* List */}
          <div className="flex flex-col gap-2 lg:overflow-y-auto lg:pr-1" data-testid="container-results">
            {!results && !isLoading && (
              <Card className="p-6 text-center border-dashed">
                <Stethoscope className="w-10 h-10 mx-auto text-emerald-600 mb-3" />
                <h3 className="font-semibold text-base mb-1">Commencez votre recherche</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Essayez par exemple : <em>"Psychologue"</em> à <em>Lens</em>, <em>"Ergothérapeute"</em> à{" "}
                  <em>Lille</em> ou <em>"Médecin généraliste"</em> à <em>Compiègne</em>.
                </p>
                <p className="text-xs text-muted-foreground">
                  Base : <strong>{totalDisplay.toLocaleString("fr")}</strong> praticiens en France
                  métropolitaine (Ameli + RPPS paramédicaux HDF). Densité APL fournie par la DREES.
                </p>
              </Card>
            )}
            {isLoading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-4 animate-pulse h-32 bg-muted/40" />
                ))}
              </>
            )}
            {results && results.results.length === 0 && (
              <Card className="p-6 text-center border-dashed" data-testid="card-no-results">
                <h3 className="font-semibold text-base mb-1">Aucun résultat</h3>
                <p className="text-sm text-muted-foreground">
                  Essayez d'élargir votre rayon, de changer de profession ou de retirer un filtre.
                </p>
              </Card>
            )}
            {results && results.results.length > 0 && (
              <>
                <div className="text-xs text-muted-foreground px-1" data-testid="text-results-count">
                  <strong>{results.total.toLocaleString("fr")}</strong> praticien{results.total > 1 ? "s" : ""}{" "}
                  trouvé{results.total > 1 ? "s" : ""}
                  {results.pages > 1 && (
                    <>
                      {" · page "}
                      <strong>{results.page}</strong>
                      {" sur "}
                      <strong>{results.pages}</strong>
                    </>
                  )}
                  {mapPoints?.truncated && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      · carte tronquée à {mapPoints.points.length.toLocaleString("fr")} points
                    </span>
                  )}
                </div>
                {results.results.map((p) => (
                  <PractitionerCard key={p.id} p={p} onLocate={() => handleLocate(p)} />
                ))}
                {results.pages > 1 && (
                  <ResultsPagination
                    page={results.page}
                    pages={results.pages}
                    onChange={(p) => {
                      setPage(p);
                      const c = document.querySelector('[data-testid="container-results"]');
                      if (c) c.scrollTop = 0;
                    }}
                  />
                )}
              </>
            )}
          </div>

          {/* Map */}
          <div
            id="map-container"
            className="h-[400px] lg:h-full rounded-lg overflow-hidden border border-border relative"
          >
            <MapContainer
              center={center || HDF_CENTER}
              zoom={center ? 12 : 6}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />
              <MapAutoFit bounds={results?.bounds ?? null} center={center} />
              <MapFlyTo target={mapFlyTarget} />
              {mapPoints && mapPoints.points.length > 0 && (
                <MapClusterLayer points={mapPoints.points} />
              )}
            </MapContainer>
          </div>
        </div>

        {/* Legend */}
        {results && results.results.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground flex flex-wrap gap-4 px-1" data-testid="map-legend">
            <span className="inline-flex items-center gap-1.5">
              <span className="custom-marker !static !block w-3 h-3 rounded-full" /> Praticien standard
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="custom-marker hors-radar !static !block w-3 h-3 rounded-full" /> Profil discret
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="custom-marker under-supplied !static !block w-3 h-3 rounded-full" /> Zone sous-dotée (APL)
            </span>
          </div>
        )}
      </main>

      {/* How it works */}
      <section className="border-t border-border bg-muted/30 mt-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="text-emerald-600 dark:text-emerald-400 mb-2">
              <Sparkles className="w-5 h-5" />
            </div>
            <h3 className="font-semibold mb-1">Score hors-radar v2</h3>
            <p className="text-sm text-muted-foreground">
              Chaque praticien reçoit un score 0–100 basé sur 5 signaux : pas de téléphone publié (+30),
              pas d'horaires publiés (+20), commune en zone sous-dotée (+25, APL DREES quintile ≤ 2),
              convention Secteur 1 (+15), exercice libéral (+10). Le tri "hors-radar" privilégie ces praticiens —
              souvent plus disponibles, jamais en première page Google ou Doctolib.
            </p>
          </div>
          <div>
            <div className="text-emerald-600 dark:text-emerald-400 mb-2">
              <DbIcon className="w-5 h-5" />
            </div>
            <h3 className="font-semibold mb-1">Trois sources publiques</h3>
            <p className="text-sm text-muted-foreground">
              <a
                className="underline hover:text-foreground"
                href="https://public.opendatasoft.com/explore/dataset/annuaire-des-professionnels-de-sante/"
                target="_blank"
                rel="noreferrer"
              >
                Annuaire Ameli
              </a>{" "}
              (médecins, spécialistes, paramédicaux conventionnés) ·{" "}
              <a
                className="underline hover:text-foreground"
                href="https://www.data.gouv.fr/datasets/annuaire-sante-extractions-des-donnees-en-libre-acces-des-professionnels-intervenant-dans-le-systeme-de-sante/"
                target="_blank"
                rel="noreferrer"
              >
                RPPS / Annuaire Santé ANS
              </a>{" "}
              (psychologues, ostéopathes, ergothérapeutes…) ·{" "}
              <a
                className="underline hover:text-foreground"
                href="https://www.data.gouv.fr/datasets/laccessibilite-potentielle-localisee-apl/"
                target="_blank"
                rel="noreferrer"
              >
                APL DREES
              </a>{" "}
              (densité communale par profession). Licence Ouverte 2.0.
            </p>
          </div>
          <div>
            <div className="text-emerald-600 dark:text-emerald-400 mb-2">
              <MapPin className="w-5 h-5" />
            </div>
            <h3 className="font-semibold mb-1">Avertissement & retrait</h3>
            <p className="text-sm text-muted-foreground">
              Cet outil ne remplace pas un avis médical. En cas d'urgence : <strong>15</strong> (SAMU)
              ou <strong>112</strong>. Praticien souhaitant le retrait :{" "}
              <a
                href="mailto:je.podik@gmail.com"
                className="underline hover:text-foreground"
                data-testid="link-removal"
              >
                je.podik@gmail.com
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 text-xs text-muted-foreground flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <div>
            Outil NutricellScience —{" "}
            <span data-testid="text-footer-stats">
              {totalDisplay.toLocaleString("fr")} praticiens
              {stats && (
                <>
                  {" · "}
                  {stats.horsRadar.toLocaleString("fr")} score hors-radar ≥ 50
                  {" · "}
                  {stats.underSupplied.toLocaleString("fr")} communes sous-dotées
                </>
              )}
            </span>
            {" · "} Ameli + RPPS / ANS + APL DREES — Licence Ouverte 2.0
          </div>
          <a
            href="https://nutricellscience.blog"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
            data-testid="link-nutricellscience"
          >
            nutricellscience.blog →
          </a>
        </div>
      </footer>
      {/* Hidden anchor so we can reference open commune at top-level if needed */}
      <span className="hidden" data-testid="open-insee">{openInsee || ""}</span>
    </div>
  );
}
