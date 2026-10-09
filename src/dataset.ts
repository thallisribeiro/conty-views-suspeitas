// Dataset sintético e reproduzível: mesma seed, mesmas séries, byte a byte. Não usa Math.random nem rede.

import type { HourlyViews } from './classifier';
import { DEFAULT_TIMEZONE, localHour } from './local-time';

export const DEFAULT_SEED = 20261009;
const HOUR_MS = 3_600_000;

export type Label = 'legitimate' | 'suspicious';
export type Scenario =
  | 'baseline'
  | 'organic_viral'
  | 'slow_growth'
  | 'niche_noisy'
  | 'live_event'
  | 'bought_plateau'
  | 'step_cliff'
  | 'mechanical_drip'
  | 'night_injection';

export interface LabeledSeries {
  id: string;
  scenario: Scenario;
  label: Label;
  timezone: string;
  series: HourlyViews[];
}

// ---------- PRNG (mulberry32) ----------

export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uniform = (lo: number, hi: number) => lo + (hi - lo) * next();
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  return {
    next,
    uniform,
    normal,
    int: (lo: number, hi: number) => Math.floor(uniform(lo, hi + 1)),
    logUniform: (lo: number, hi: number) => Math.exp(uniform(Math.log(lo), Math.log(hi))),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    /** Contagem de pessoas independentes: Poisson (Knuth abaixo de 30, aproximação normal acima). */
    poisson(lambda: number): number {
      if (lambda <= 0) return 0;
      if (lambda < 30) {
        const limit = Math.exp(-lambda);
        let k = 0;
        let p = 1;
        do {
          k++;
          p *= next();
        } while (p > limit);
        return k - 1;
      }
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
    },
  };
}
export type Rng = ReturnType<typeof createRng>;

// ---------- modelo de audiência humana ----------

/** Peso de cada hora do dia (hora local). Pico à noite, vale às 4h. Média 1. */
const RAW_DAILY = [
  0.6, 0.4, 0.25, 0.18, 0.15, 0.18, 0.3, 0.5, 0.7, 0.8, 0.85, 0.9, 1.0, 1.0, 0.95, 0.95, 1.0, 1.05, 1.15, 1.3, 1.4,
  1.4, 1.2, 0.9,
];
const dailyMean = RAW_DAILY.reduce((a, b) => a + b, 0) / RAW_DAILY.length;
export const DAILY = RAW_DAILY.map((x) => x / dailyMean);

const smoothstep = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Sobe suave até 1 em `rise` horas e decai com meia-vida `halfLife`. É o formato de um viral orgânico. */
export function viralPulse(i: number, start: number, rise: number, halfLife: number): number {
  const t = i - start;
  if (t < 0) return 0;
  if (t < rise) return smoothstep(t / rise);
  return 0.5 ** ((t - rise) / halfLife);
}

/** Fração da hora [i, i+1) coberta pelo intervalo [from, to). Robô que liga às 03h20 cobre 2/3 da hora 3. */
export function coverage(i: number, from: number, to: number): number {
  return Math.max(0, Math.min(i + 1, to) - Math.max(i, from));
}

export interface RenderSpec {
  hours: number;
  /** Primeira hora da série (meia-noite local em São Paulo nos geradores). */
  start: Date;
  timezone?: string;
  /** Views/h esperadas de gente real, antes do ruído. */
  human: (i: number, localHour: number) => number;
  /** Ruído multiplicativo (lognormal) da audiência real: compartilhamentos vêm em rajadas. */
  noise: number;
  /** Views/h do robô, já com o ruído que ele tiver. */
  bot?: (i: number, localHour: number) => number;
}

export function render(rng: Rng, spec: RenderSpec): HourlyViews[] {
  const timezone = spec.timezone ?? DEFAULT_TIMEZONE;
  return Array.from({ length: spec.hours }, (_, i) => {
    const hour = new Date(spec.start.getTime() + i * HOUR_MS);
    const h = localHour(hour, timezone);
    const mu = spec.human(i, h) * Math.exp(spec.noise * rng.normal() - (spec.noise * spec.noise) / 2);
    const bot = spec.bot ? Math.max(0, Math.round(spec.bot(i, h))) : 0;
    return { hour, views: rng.poisson(mu) + bot };
  });
}

/** Meia-noite em São Paulo (03:00 UTC) de um dia de setembro de 2026. */
export const localMidnight = (day: number) => new Date(Date.UTC(2026, 8, 1 + day, 3));

// ---------- cenários ----------

type Generator = (rng: Rng) => RenderSpec;

const legitimate: Record<string, Generator> = {
  /** Rotina: ciclo diário e ruído, sem evento. */
  baseline(rng) {
    const base = rng.logUniform(20, 3000);
    return { hours: rng.int(72, 168), start: localMidnight(rng.int(0, 29)), noise: rng.uniform(0.1, 0.3), human: (_, h) => base * DAILY[h] };
  },
  /** Vídeo que estoura: sobe em 2 a 8 horas, decai com meia-vida de 3 a 36 horas, segue o ciclo do dia. */
  organic_viral(rng) {
    const hours = rng.int(96, 168);
    const base = rng.logUniform(20, 1000);
    const start = rng.int(24, hours - 48) + rng.next();
    const height = base * rng.logUniform(10, 100);
    const rise = rng.uniform(2, 8);
    const halfLife = rng.uniform(3, 36);
    const newFollowers = rng.uniform(0, 0.5);
    return {
      hours,
      start: localMidnight(rng.int(0, 29)),
      noise: rng.uniform(0.1, 0.3),
      human: (i, h) =>
        (base * (1 + newFollowers * smoothstep((i - start) / 24)) + height * viralPulse(i, start, rise, halfLife)) * DAILY[h],
    };
  },
  /** Canal crescendo devagar: 2× a 8× ao longo da série. */
  slow_growth(rng) {
    const hours = rng.int(72, 168);
    const base = rng.logUniform(20, 1000);
    const growth = rng.uniform(2, 8);
    return {
      hours,
      start: localMidnight(rng.int(0, 29)),
      noise: rng.uniform(0.1, 0.25),
      human: (i, h) => base * growth ** (i / hours) * DAILY[h],
    };
  },
  /** Nicho pequeno e barulhento: ruído alto e rajadas de 1 a 3 horas (alguém compartilhou num grupo). */
  niche_noisy(rng) {
    const hours = rng.int(72, 168);
    const base = rng.logUniform(5, 150);
    const bursts = Array.from({ length: rng.int(0, 3) }, () => ({
      at: rng.int(24, hours - 4),
      length: rng.int(1, 3),
      boost: rng.uniform(3, 10),
    }));
    return {
      hours,
      start: localMidnight(rng.int(0, 29)),
      noise: rng.uniform(0.5, 0.9),
      human: (i, h) => {
        const burst = bursts.find((b) => i >= b.at && i < b.at + b.length);
        return base * DAILY[h] * (burst ? burst.boost : 1);
      },
    };
  },
  /**
   * Live ou evento: começa entre 18h e 22h, dura 1 a 3 horas, o replay decai com meia-vida de 1 a 4 horas.
   * A live em si é um compromisso marcado (não segue o ciclo do dia); o replay é gente assistindo quando pode, e segue.
   */
  live_event(rng) {
    const hours = rng.int(72, 168);
    const base = rng.logUniform(20, 500);
    const begin = 24 * rng.int(1, Math.floor(hours / 24) - 2) + rng.int(18, 22) + rng.uniform(0, 0.75);
    const end = begin + rng.int(1, 3);
    const height = base * rng.logUniform(20, 200);
    const replay = rng.uniform(0.2, 0.6);
    const halfLife = rng.uniform(1, 4);
    return {
      hours,
      start: localMidnight(rng.int(0, 29)),
      noise: rng.uniform(0.1, 0.3),
      human: (i, h) => {
        const live = height * coverage(i, begin, end);
        const after = i + 1 > end ? height * replay * 0.5 ** (Math.max(0, i - end) / halfLife) * (1 - coverage(i, begin, end)) : 0;
        return (base + after) * DAILY[h] + live;
      },
    };
  },
};

/** Audiência real de fundo, igual à rotina, por baixo do robô. */
function organicBackground(rng: Rng, minBase: number, maxBase: number) {
  const hours = rng.int(72, 168);
  const base = rng.logUniform(minBase, maxBase);
  return {
    hours,
    base,
    spec: {
      hours,
      start: localMidnight(rng.int(0, 29)),
      noise: rng.uniform(0.1, 0.3),
      human: (_: number, h: number) => base * DAILY[h],
    },
  };
}

const suspicious: Record<string, Generator> = {
  /** Pico comprado: 5 a 14 horas num nível quase constante (ruído de 0,5% a 4%), começa e para de uma vez. */
  bought_plateau(rng) {
    const { hours, base, spec } = organicBackground(rng, 20, 2000);
    const from = rng.int(24, hours - 30) + rng.next();
    const to = from + rng.int(5, 14);
    const level = base * rng.logUniform(8, 100);
    const jitter = rng.uniform(0.005, 0.04);
    return { ...spec, bot: (i) => (coverage(i, from, to) > 0 ? level * coverage(i, from, to) * (1 + jitter * rng.normal()) : 0) };
  },
  /** Degrau e corte: entra de uma vez, o nível desliza ±40% com ruído de 5% a 15%, e some de uma vez. */
  step_cliff(rng) {
    const { hours, base, spec } = organicBackground(rng, 20, 2000);
    const from = rng.int(24, hours - 30) + rng.next();
    const length = rng.int(4, 18);
    const to = from + length;
    const level = base * rng.logUniform(8, 60);
    const tilt = rng.uniform(-0.4, 0.4);
    const jitter = rng.uniform(0.05, 0.15);
    return {
      ...spec,
      bot: (i) => {
        const c = coverage(i, from, to);
        return c > 0 ? level * (1 + tilt * ((2 * (i - from)) / length - 1)) * c * (1 + jitter * rng.normal()) : 0;
      },
    };
  },
  /** Entrega programada numa conta pequena: o mesmo número toda hora, ou o mesmo incremento (rampa ou triângulo). */
  mechanical_drip(rng) {
    const { hours, spec } = organicBackground(rng, 2, 15);
    const from = rng.int(24, hours - 40);
    const length = rng.int(10, 36);
    const mode = rng.pick(['constant', 'ramp', 'triangle'] as const);
    const level = rng.int(300, 3000);
    const first = rng.int(100, 500);
    const step = rng.int(20, 150);
    return {
      ...spec,
      bot: (i) => {
        const k = i - from;
        if (k < 0 || k >= length) return 0;
        if (mode === 'constant') return level;
        if (mode === 'ramp') return first + step * k;
        return first + step * Math.min(k, length - 1 - k);
      },
    };
  },
  /** Injeção na madrugada: liga entre 23h e 02h, 4 a 8 horas, ruído de 8% a 20%, sem respeitar o sono de ninguém. */
  night_injection(rng) {
    const { hours, base, spec } = organicBackground(rng, 20, 1000);
    const day = rng.int(1, Math.floor(hours / 24) - 2);
    const from = 24 * day + rng.pick([-1, 0, 1, 2]) + rng.next();
    const to = from + rng.int(4, 8);
    const level = base * rng.logUniform(5, 40);
    const jitter = rng.uniform(0.08, 0.2);
    return { ...spec, bot: (i) => (coverage(i, from, to) > 0 ? level * coverage(i, from, to) * (1 + jitter * rng.normal()) : 0) };
  },
};

const PER_SCENARIO = { legitimate: 100, suspicious: 60 };

/** FNV-1a: transforma "seed:id" na seed de uma série. */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function generateDataset(seed = DEFAULT_SEED): LabeledSeries[] {
  const out: LabeledSeries[] = [];
  const groups = [
    ['legitimate', legitimate],
    ['suspicious', suspicious],
  ] as const;
  for (const [label, generators] of groups) {
    for (const [scenario, generate] of Object.entries(generators)) {
      for (let k = 0; k < PER_SCENARIO[label]; k++) {
        const id = `${scenario}-${String(k + 1).padStart(3, '0')}`;
        // Uma seed por série: mexer num cenário não muda as séries dos outros.
        const rng = createRng(hashSeed(`${seed}:${id}`));
        out.push({
          id,
          scenario: scenario as Scenario,
          label,
          timezone: DEFAULT_TIMEZONE,
          series: render(rng, generate(rng)),
        });
      }
    }
  }
  return out;
}
