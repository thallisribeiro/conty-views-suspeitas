// Classificador por regras: cinco sinais medidos na série, cada um com valor, limiar e frase em português.
// Nenhum sinal sozinho acusa. A regra de decisão está em `decide` e no README.

import { formatDecimal, formatInt, formatPercent, formatWhen, localHour } from './local-time';

export interface HourlyViews {
  /** Início da hora. */
  hour: Date;
  /** Views ganhas naquela hora (não é o contador acumulado). */
  views: number;
}

export type Classification = 'legitimate' | 'suspicious' | 'inconclusive';

export type SignalName =
  | 'abrupt_rise'
  | 'flat_plateau'
  | 'cliff_drop'
  | 'mechanical_repetition'
  | 'no_day_night_cycle';

export interface Signal {
  name: SignalName;
  /** "supporting" conta para a combinação, mas sozinho não muda nada (ver README). */
  strength: 'strong' | 'supporting';
  /** Valor medido. null quando não deu para medir (a descrição diz por quê). */
  value: number | null;
  threshold: number;
  firesWhen: '<=' | '>=';
  fired: boolean;
  description: string;
}

export interface ClassificationResult {
  classification: Classification;
  reason: string;
  signals: Signal[];
}

/** Todos os limiares num lugar só. O README explica de onde vem cada um. */
export const RULES = {
  minHours: 48,
  baselineHours: 24,
  baselineMinHours: 12,
  peakMinRatio: 5,
  riseMaxHours: 2,
  plateauMaxCv: 0.05,
  plateauMinHours: 4,
  cliffMaxHours: 2,
  cliffMinTopHours: 3,
  repetitionWindowHours: 8,
  repetitionMinViews: 100,
  repetitionMaxNoise: 0.15,
  nightHours: [3, 4, 5],
  nightMinHours: 2,
  nightLevel: 0.8,
  nightMinShare: 0.5,
} as const;

const pad2 = (h: number) => String(h).padStart(2, '0');
const NIGHT_LABEL = `entre ${pad2(RULES.nightHours[0])}h e ${pad2(RULES.nightHours[RULES.nightHours.length - 1] + 1)}h`;

const HUMAN_PATTERN =
  'Audiência humana sobe e decai de forma gradual, oscila por acaso de hora em hora e cai de madrugada.';

// ---------- estatística básica ----------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
}
const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;
const hoursLabel = (h: number) => (h === 1 ? 'uma hora' : `${h} horas`);

// ---------- o pico ----------

interface Peak {
  max: number;
  maxIndex: number;
  /** Trecho contínuo em volta do máximo com views >= metade do máximo. */
  topStart: number;
  topEnd: number;
  /** Mediana das 24h antes do topo: o "nível normal" do canal. */
  baseline: number;
  /** Até 2× o normal (mínimo 10): a hora ainda "está no normal". Marca onde a subida começou. */
  near: number;
  ratio: number;
}

type PeakAnalysis =
  | { peak: Peak }
  /** "flat": não há pico. "no-history": há pico, mas no começo da série, sem como saber o normal antes dele. */
  | { peak: null; kind: 'flat' | 'no-history'; why: string };

function findPeak(v: number[]): PeakAnalysis {
  let maxIndex = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[maxIndex]) maxIndex = i;
  const max = v[maxIndex];
  let topStart = maxIndex;
  while (topStart > 0 && v[topStart - 1] >= max / 2) topStart--;
  let topEnd = maxIndex;
  while (topEnd < v.length - 1 && v[topEnd + 1] >= max / 2) topEnd++;

  const flat = (ratio: number) => ({
    peak: null,
    kind: 'flat' as const,
    why: `não há pico (a maior hora, ${formatInt(max)}/h, é só ${formatDecimal(ratio)}× o nível normal; pico conta a partir de ${RULES.peakMinRatio}×)`,
  });
  const history = v.slice(Math.max(0, topStart - RULES.baselineHours), topStart);
  if (history.length < RULES.baselineMinHours) {
    const ratio = max / Math.max(median(v), 1);
    if (ratio < RULES.peakMinRatio) return flat(ratio);
    return {
      peak: null,
      kind: 'no-history',
      why: `o maior pico (${formatInt(max)}/h) está nas primeiras horas da série, sem pelo menos ${RULES.baselineMinHours} horas antes para saber o que era normal`,
    };
  }
  const baseline = median(history);
  const ratio = max / Math.max(baseline, 1);
  if (ratio < RULES.peakMinRatio) return flat(ratio);
  return {
    peak: { max, maxIndex, topStart, topEnd, baseline, near: Math.max(2 * baseline, 10), ratio },
  };
}

// ---------- os sinais ----------

interface Context {
  views: number[];
  hours: Date[];
  timezone: string;
  analysis: PeakAnalysis;
}

const when = (ctx: Context, i: number) => formatWhen(ctx.hours[i], ctx.timezone);

function notApplicable(base: Omit<Signal, 'value' | 'fired' | 'description'>, why: string): Signal {
  return { ...base, value: null, fired: false, description: `Não se aplica: ${why}.` };
}

/** Quantas horas levou para sair do nível normal e passar da metade do máximo. */
function abruptRise(ctx: Context): Signal {
  const base = {
    name: 'abrupt_rise',
    strength: 'supporting',
    threshold: RULES.riseMaxHours,
    firesWhen: '<=',
  } as const;
  if (!ctx.analysis.peak) return notApplicable(base, ctx.analysis.why);
  const p = ctx.analysis.peak;
  const v = ctx.views;
  let from = p.topStart - 1;
  while (from >= 0 && v[from] > p.near) from--;
  if (from < 0) return notApplicable(base, 'a série começa já no alto, sem um trecho normal antes do pico');
  const hours = p.topStart - from;
  const fired = hours <= RULES.riseMaxHours;
  const description = fired
    ? `Subida em degrau: até ${when(ctx, p.topStart)} as views saltaram de ~${formatInt(v[from])}/h para ${formatInt(v[p.topStart])}/h em ${hoursLabel(hours)}.`
    : `A subida foi gradual: levou ${hoursLabel(hours)} para sair do nível normal (~${formatInt(p.baseline)}/h) e passar da metade do pico (degrau seria até ${RULES.riseMaxHours} horas).`;
  return { ...base, value: hours, fired, description };
}

/** Variação (coeficiente de variação) no topo do pico, sem a primeira e a última hora, que podem ser parciais. */
function flatPlateau(ctx: Context): Signal {
  const base = {
    name: 'flat_plateau',
    strength: 'strong',
    threshold: RULES.plateauMaxCv,
    firesWhen: '<=',
  } as const;
  if (!ctx.analysis.peak) return notApplicable(base, ctx.analysis.why);
  const p = ctx.analysis.peak;
  const inner = ctx.views.slice(p.topStart + 1, p.topEnd);
  if (inner.length < RULES.plateauMinHours) {
    return notApplicable(base, `o topo do pico durou ${hoursLabel(p.topEnd - p.topStart + 1)}, pouco para medir um platô`);
  }
  const cv = coefficientOfVariation(inner);
  const fired = cv <= RULES.plateauMaxCv;
  const description = fired
    ? `Platô mecânico: de ${when(ctx, p.topStart + 1)} a ${when(ctx, p.topEnd - 1)} (${inner.length} horas) as views ficaram quase constantes em ~${formatInt(mean(inner))}/h, variação de ${formatPercent(cv)}. Audiência real oscila e vai perdendo força depois do pico.`
    : `O topo do pico variou ${formatPercent(cv)} em ${inner.length} horas, como audiência real (platô mecânico seria até ${formatPercent(RULES.plateauMaxCv)}).`;
  return { ...base, value: round(cv, 4), fired, description };
}

/** Quantas horas levou para sair do topo e voltar perto do nível de antes do pico. */
function cliffDrop(ctx: Context): Signal {
  const base = {
    name: 'cliff_drop',
    strength: 'strong',
    threshold: RULES.cliffMaxHours,
    firesWhen: '<=',
  } as const;
  if (!ctx.analysis.peak) return notApplicable(base, ctx.analysis.why);
  const p = ctx.analysis.peak;
  const v = ctx.views;
  const topHours = p.topEnd - p.topStart + 1;
  if (topHours < RULES.cliffMinTopHours) {
    return notApplicable(base, `o pico ficou no alto só ${hoursLabel(topHours)}; um pico tão curto que some pode ser um compartilhamento isolado`);
  }
  // "De volta ao normal" é por horário: às 2h o normal do canal é bem menor que às 20h. A referência é a
  // mesma hora (com as vizinhas) nos dias antes do topo, o menor deles, para não pegar a subida de um
  // viral como "normal". Sem nenhum dia antes, vale a mediana das 24h antes do topo.
  const normalAt = (i: number) => {
    let lowest = Infinity;
    for (let j = i - 24; j >= 1; j -= 24) {
      if (j + 1 < p.topStart) lowest = Math.min(lowest, median([v[j - 1], v[j], v[j + 1]]));
    }
    return lowest === Infinity ? p.baseline : lowest;
  };
  let to = p.topEnd + 1;
  while (to < v.length && v[to] > Math.max(2 * normalAt(to), 10)) to++;
  if (to >= v.length) return notApplicable(base, 'a série termina antes de as views voltarem ao nível de antes do pico');
  const hours = to - p.topEnd;
  const fired = hours <= RULES.cliffMaxHours;
  const description = fired
    ? `Queda abrupta: depois de ${hoursLabel(topHours)} no alto, as views caíram de ${formatInt(v[p.topEnd])}/h para ${formatInt(v[to])}/h em ${hoursLabel(hours)} (${when(ctx, to)}), de volta ao normal do canal nesse horário (~${formatInt(normalAt(to))}/h nos dias antes do pico).`
    : `A queda foi gradual: levou ${hoursLabel(hours)} para voltar ao normal do canal para o horário (queda abrupta seria até ${RULES.cliffMaxHours} horas).`;
  return { ...base, value: hours, fired, description };
}

/**
 * Oscilação hora a hora comparada com o mínimo do acaso. Pessoas que assistem de forma independente
 * fazem a contagem oscilar pelo menos ±raiz(média) (Poisson). Usa a segunda diferença, que zera
 * tanto "mesmo valor toda hora" quanto "mesmo incremento toda hora".
 */
function mechanicalRepetition(ctx: Context): Signal {
  const base = {
    name: 'mechanical_repetition',
    strength: 'strong',
    threshold: RULES.repetitionMaxNoise,
    firesWhen: '<=',
  } as const;
  const v = ctx.views;
  const W = RULES.repetitionWindowHours;
  // Ruído além da tendência: com valor + tendência linear + ruído σ, a segunda diferença tem variância 6σ².
  const noiseSd = (w: number[]) => {
    let squares = 0;
    for (let i = 1; i < w.length - 1; i++) squares += (w[i + 1] - 2 * w[i] + w[i - 1]) ** 2;
    return Math.sqrt(squares / ((w.length - 2) * 6));
  };
  const windows: { start: number; ratio: number }[] = [];
  for (let s = 0; s + W <= v.length; s++) {
    const w = v.slice(s, s + W);
    const m = mean(w);
    if (m >= RULES.repetitionMinViews) windows.push({ start: s, ratio: noiseSd(w) / Math.sqrt(m) });
  }
  if (!windows.length) {
    return notApplicable(base, `nenhum trecho de ${W} horas com pelo menos ${RULES.repetitionMinViews} views/h; com contagens pequenas, números repetidos acontecem por acaso`);
  }
  let best = 0;
  for (let k = 1; k < windows.length; k++) if (windows[k].ratio < windows[best].ratio) best = k;
  const ratio = windows[best].ratio;
  const fired = ratio <= RULES.repetitionMaxNoise;
  if (!fired) {
    return {
      ...base,
      value: round(ratio),
      fired,
      description: `As oscilações de hora em hora parecem acaso de audiência real: mesmo no trecho mais regular, ficaram em ${formatDecimal(ratio, 2)}× o que o acaso de pessoas reais produz (repetição mecânica seria até ${formatDecimal(RULES.repetitionMaxNoise, 2)}×).`,
    };
  }
  // Junta as janelas vizinhas que também disparam, para dizer o trecho inteiro.
  let lo = best;
  while (lo > 0 && windows[lo - 1].start === windows[lo].start - 1 && windows[lo - 1].ratio <= RULES.repetitionMaxNoise) lo--;
  let hi = best;
  while (hi < windows.length - 1 && windows[hi + 1].start === windows[hi].start + 1 && windows[hi + 1].ratio <= RULES.repetitionMaxNoise) hi++;
  const from = windows[lo].start;
  const to = windows[hi].start + W - 1;
  const stretch = v.slice(from, to + 1);
  const m = mean(stretch);
  const step = median(stretch.slice(1).map((x, i) => x - stretch[i]));
  const pattern =
    Math.abs(step) <= Math.max(2, 0.01 * m)
      ? `ficaram quase no mesmo número toda hora (~${formatInt(m)}/h)`
      : `${step > 0 ? 'subiram' : 'caíram'} quase exatamente o mesmo tanto a cada hora (${formatInt(Math.abs(step))} por hora, em torno de ${formatInt(m)}/h)`;
  return {
    ...base,
    value: round(ratio),
    fired,
    description: `Repetição mecânica: de ${when(ctx, from)} a ${when(ctx, to)} (${to - from + 1} horas) as views ${pattern}. Fora desse padrão, a oscilação foi de ±${formatInt(noiseSd(stretch))}/h; com pessoas reais, só o acaso já faria oscilar uns ±${formatInt(Math.sqrt(m))}/h nesse volume.`,
  };
}

/**
 * Gente dorme. Mede quantas horas da madrugada funda (03h às 06h, hora local) dentro do pico ficaram no
 * nível do topo do pico. Sem pico, olha a série inteira e compara com as horas mais fortes dela.
 */
function noDayNightCycle(ctx: Context): Signal {
  const base = {
    name: 'no_day_night_cycle',
    strength: 'strong',
    threshold: RULES.nightMinShare,
    firesWhen: '>=',
  } as const;
  const v = ctx.views;
  const peak = ctx.analysis.peak;
  let from = 0;
  let to = v.length - 1;
  let top: number[];
  if (peak) {
    // Janela do pico: tudo em volta do máximo que ficou acima de 3× o normal.
    const floor = Math.max(3 * peak.baseline, peak.near);
    from = peak.maxIndex;
    while (from > 0 && v[from - 1] >= floor) from--;
    to = peak.maxIndex;
    while (to < v.length - 1 && v[to + 1] >= floor) to++;
    top = v.slice(peak.topStart, peak.topEnd + 1);
  } else {
    const max = Math.max(...v);
    top = v.filter((x) => x >= max / 2);
  }
  const scope = peak ? 'pico' : 'série';
  const nightHours: readonly number[] = RULES.nightHours;
  const night: number[] = [];
  for (let i = from; i <= to; i++) if (nightHours.includes(localHour(ctx.hours[i], ctx.timezone))) night.push(i);
  if (night.length < RULES.nightMinHours) {
    return notApplicable(base, `o ${scope} não passou pela madrugada (${NIGHT_LABEL}, fuso ${ctx.timezone})`);
  }
  const topLevel = median(top);
  const atLevel = night.filter((i) => v[i] >= RULES.nightLevel * topLevel).length;
  const share = atLevel / night.length;
  const fired = share >= RULES.nightMinShare;
  const description = fired
    ? `Sem ciclo dia/noite: ${atLevel} de ${night.length} horas de madrugada (${NIGHT_LABEL}, fuso ${ctx.timezone}) durante o ${scope} ficaram no nível do topo (~${formatInt(topLevel)}/h). Gente de verdade dorme: de madrugada a audiência costuma cair para uma fração do horário nobre.`
    : `A madrugada foi mais fraca, como esperado: só ${atLevel} de ${night.length} horas de madrugada (${NIGHT_LABEL}) ficaram perto do topo do ${scope} (~${formatInt(topLevel)}/h).`;
  return { ...base, value: round(share), fired, description };
}

// ---------- decisão ----------

/**
 * Regra central:
 * - menos de 48 horas: inconclusivo, sempre;
 * - dois ou mais sinais juntos, com pelo menos um forte: suspeito;
 * - um sinal forte sozinho: inconclusivo (prefere não acusar);
 * - nenhum sinal forte: legítimo (subida rápida sozinha é o que live e viral fazem).
 */
function decide(signals: Signal[], ctx: Context): Pick<ClassificationResult, 'classification' | 'reason'> {
  const n = ctx.views.length;
  const fired = signals.filter((s) => s.fired);
  const strong = fired.filter((s) => s.strength === 'strong');

  if (n < RULES.minHours) {
    return {
      classification: 'inconclusive',
      reason: `Inconclusivo: a série tem só ${n} horas. Para julgar um pico são necessárias pelo menos ${RULES.minHours} horas (dois dias), para conhecer o ritmo normal do canal antes dele.`,
    };
  }
  if (fired.length >= 2 && strong.length >= 1) {
    return {
      classification: 'suspicious',
      reason: `Suspeito: ${fired.length} sinais de automação apareceram juntos. ${fired.map((s) => s.description).join(' ')} ${HUMAN_PATTERN}`,
    };
  }
  if (strong.length === 1) {
    return {
      classification: 'inconclusive',
      reason: `Inconclusivo: só um sinal apareceu, e um sinal sozinho não basta para acusar. ${strong[0].description} Pode ser automação, mas também pode ter explicação real (live que acabou sem replay, audiência de outro fuso). Vale uma olhada humana ou uma série mais longa.`,
    };
  }
  if (!ctx.analysis.peak && ctx.analysis.kind === 'no-history') {
    return {
      classification: 'inconclusive',
      reason: `Inconclusivo: ${ctx.analysis.why}. Sem isso não dá para medir como o pico subiu nem se voltou ao normal. Envie a série começando pelo menos ${RULES.baselineHours} horas antes do pico.`,
    };
  }
  return { classification: 'legitimate', reason: legitimateReason(signals, ctx) };
}

function legitimateReason(signals: Signal[], ctx: Context): string {
  const lead = 'Legítimo: nenhum sinal de automação.';
  if (!ctx.analysis.peak) {
    const why = ctx.analysis.why;
    return `${lead} ${why.charAt(0).toUpperCase()}${why.slice(1)} e as views oscilam de forma natural.`;
  }
  const p = ctx.analysis.peak;
  const rise = signals.find((s) => s.name === 'abrupt_rise')!;
  const cliff = signals.find((s) => s.name === 'cliff_drop')!;
  const topHours = p.topEnd - p.topStart + 1;
  const peakText = `O pico de ${when(ctx, p.maxIndex)} (${formatInt(p.max)}/h, ${formatDecimal(p.ratio)}× o normal)`;
  const riseText = rise.fired ? ' subiu rápido, o que é comum em live e em vídeo que estoura, mas' : '';
  let fallText: string;
  if (cliff.value !== null) {
    fallText = ` levou ${hoursLabel(cliff.value)} para voltar ao normal do canal, perdendo força aos poucos como audiência real.`;
  } else if (topHours < RULES.cliffMinTopHours) {
    fallText = ` ficou só ${hoursLabel(topHours)} no alto, como um compartilhamento isolado.`;
  } else {
    fallText = ' ainda estava acima do nível anterior quando a série terminou, sem queda brusca.';
  }
  return `${lead} ${peakText}${riseText}${fallText}`;
}

export function classify(series: HourlyViews[], timezone: string): ClassificationResult {
  const views = series.map((p) => p.views);
  const ctx: Context = { views, hours: series.map((p) => p.hour), timezone, analysis: findPeak(views) };
  const signals = [abruptRise(ctx), flatPlateau(ctx), cliffDrop(ctx), mechanicalRepetition(ctx), noDayNightCycle(ctx)];
  return { ...decide(signals, ctx), signals };
}
