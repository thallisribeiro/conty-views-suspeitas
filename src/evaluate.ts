// Gera o dataset, classifica tudo e mede. É a fonte única do número que vai no README.

import { classify, type Classification } from './classifier';
import { DEFAULT_SEED, generateDataset, type Label, type Scenario } from './dataset';

type Counts = Record<Classification, number>;
const empty = (): Counts => ({ legitimate: 0, suspicious: 0, inconclusive: 0 });

export interface EvaluationResult {
  seed: number;
  total: number;
  /** Linha = rótulo verdadeiro, coluna = o que o classificador disse. */
  confusion: Record<Label, Counts>;
  /** Legítimos acusados de suspeitos ÷ legítimos. */
  falsePositiveRate: number;
  /** Suspeitos classificados como suspeitos ÷ suspeitos. */
  detectionRate: number;
  /** Onde o classificador preferiu não acusar. */
  inconclusiveRate: Record<Label, number>;
  byScenario: Record<string, { label: Label } & Counts>;
  falsePositives: string[];
  missedAsLegitimate: string[];
}

export function evaluate(seed = DEFAULT_SEED): EvaluationResult {
  const confusion: Record<Label, Counts> = { legitimate: empty(), suspicious: empty() };
  const byScenario: Partial<Record<Scenario, { label: Label } & Counts>> = {};
  const falsePositives: string[] = [];
  const missedAsLegitimate: string[] = [];
  const dataset = generateDataset(seed);

  for (const item of dataset) {
    const { classification } = classify(item.series, item.timezone);
    confusion[item.label][classification]++;
    const row = (byScenario[item.scenario] ??= { label: item.label, ...empty() });
    row[classification]++;
    if (item.label === 'legitimate' && classification === 'suspicious') falsePositives.push(item.id);
    if (item.label === 'suspicious' && classification === 'legitimate') missedAsLegitimate.push(item.id);
  }

  const totalOf = (c: Counts) => c.legitimate + c.suspicious + c.inconclusive;
  const legit = totalOf(confusion.legitimate);
  const susp = totalOf(confusion.suspicious);
  return {
    seed,
    total: dataset.length,
    confusion,
    falsePositiveRate: confusion.legitimate.suspicious / legit,
    detectionRate: confusion.suspicious.suspicious / susp,
    inconclusiveRate: {
      legitimate: confusion.legitimate.inconclusive / legit,
      suspicious: confusion.suspicious.inconclusive / susp,
    },
    byScenario,
    falsePositives,
    missedAsLegitimate,
  };
}

/** Mesma avaliação com outras seeds, para mostrar quanto o número oscila só pelo sorteio do dataset. */
export const SENSITIVITY_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function seedSensitivity(seeds = SENSITIVITY_SEEDS) {
  const runs = seeds.map((seed) => evaluate(seed));
  const range = (xs: number[]) => ({ min: Math.min(...xs), max: Math.max(...xs) });
  return {
    seeds,
    falsePositiveRate: range(runs.map((r) => r.falsePositiveRate)),
    detectionRate: range(runs.map((r) => r.detectionRate)),
  };
}
