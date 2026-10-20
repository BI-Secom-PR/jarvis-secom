// Estado do /dashboard que sobrevive a refresh e a nova sessão (localStorage).
// Só funções puras: leitura/escrita do storage fica no componente.

import { ISO_DATE, METRICS, type MetricKey } from '@/lib/dashboard';

export const PRESET_DAYS = [7, 14, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];

export type Prefs = {
  /** Atalho relativo ("últimos N dias"); quando presente, from/to são ignorados. */
  days?: PresetDays;
  from?: string;
  to?: string;
  campaigns: string[];
  platforms: string[];
  networks: string[];
  ads: string[];
  objectives: string[];
  buyingTypes: string[];
  temas: string[];
  tab: 'campanhas' | 'demografia' | 'regiao';
  metric: MetricKey;
  gran: 'dia' | 'semana' | 'mes';
  tmode: 'campanha' | 'anuncio';
  engMode: 'total' | 'partes';
  byNetwork: boolean;
};

/** Uma chave por usuário: dois logins no mesmo navegador não herdam filtros um do outro. */
export const prefsKey = (userId: string) => `jarvis.dashboard.v1:${userId}`;

const strs = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : undefined;
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  allowed.find((a) => a === v);
const date = (v: unknown): string | undefined =>
  typeof v === 'string' && ISO_DATE.test(v) ? v : undefined;

/** JSON do storage → o que for válido. Campo inválido é descartado, não derruba os outros;
    JSON quebrado ou não-objeto devolve `{}` (o dashboard abre nos padrões). */
export function parsePrefs(raw: string | null): Partial<Prefs> {
  let o: Record<string, unknown>;
  try {
    const j = JSON.parse(raw ?? '');
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    o = j as Record<string, unknown>;
  } catch { return {}; }

  const p: Partial<Prefs> = {
    days: PRESET_DAYS.find((d) => d === o.days),
    from: date(o.from),
    to: date(o.to),
    campaigns: strs(o.campaigns),
    platforms: strs(o.platforms),
    networks: strs(o.networks),
    ads: strs(o.ads),
    objectives: strs(o.objectives),
    buyingTypes: strs(o.buyingTypes),
    temas: strs(o.temas),
    tab: oneOf(o.tab, ['campanhas', 'demografia', 'regiao']),
    metric: typeof o.metric === 'string' && Object.hasOwn(METRICS, o.metric) ? (o.metric as MetricKey) : undefined,
    gran: oneOf(o.gran, ['dia', 'semana', 'mes']),
    tmode: oneOf(o.tmode, ['campanha', 'anuncio']),
    engMode: oneOf(o.engMode, ['total', 'partes']),
    byNetwork: typeof o.byNetwork === 'boolean' ? o.byNetwork : undefined,
  };
  // from/to só valem em par, e invertidos viram período vazio.
  if (!p.from || !p.to || p.from > p.to) { delete p.from; delete p.to; }
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Partial<Prefs>;
}
