import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, generateDataset } from '../src/dataset';
import { evaluate, formatConfusion, seedSensitivity } from '../src/evaluate';
import { formatPercent } from '../src/local-time';

// Sem \r: num clone do Windows com autocrlf o README vem com CRLF.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** Extrai o texto entre <!-- nome --> e <!-- /nome --> no README. */
function marker(name: string): string {
  const match = readme.match(new RegExp(`<!-- ${name} -->(.*?)<!-- /${name} -->`));
  if (!match) throw new Error(`README sem o marcador <!-- ${name} -->`);
  return match[1];
}

const measured = evaluate();

describe('número do README = número medido', () => {
  it('a taxa de falso positivo escrita no README é a que o comando de avaliação mede', () => {
    expect(marker('fp-rate')).toBe(formatPercent(measured.falsePositiveRate));
  });

  it('a taxa de detecção escrita no README é a que o comando de avaliação mede', () => {
    expect(marker('detection-rate')).toBe(formatPercent(measured.detectionRate));
  });

  it('as faixas de falso positivo e de detecção em outras seeds escritas no README são as medidas', () => {
    const { falsePositiveRate: fp, detectionRate: det } = seedSensitivity();
    expect(marker('fp-range')).toBe(`${formatPercent(fp.min)} a ${formatPercent(fp.max)}`);
    expect(marker('detection-range')).toBe(`${formatPercent(det.min)} a ${formatPercent(det.max)}`);
  });

  it('a matriz de confusão, as contagens e os casos citados no README são os medidos', () => {
    expect(readme).toContain(formatConfusion(measured));
    const legit = measured.confusion.legitimate;
    const susp = measured.confusion.suspicious;
    expect(marker('fp-count')).toBe(`${legit.suspicious} de ${legit.legitimate + legit.suspicious + legit.inconclusive}`);
    expect(marker('inconclusive-suspicious')).toBe(`${susp.inconclusive} suspeitos (${formatPercent(measured.inconclusiveRate.suspicious)})`);
    expect(marker('missed-count')).toBe(String(measured.missedAsLegitimate.length));
    for (const id of [...measured.falsePositives, ...measured.missedAsLegitimate]) expect(readme).toContain(`\`${id}\``);
  });

  it('eval-result.json no repositório está atualizado com a avaliação', () => {
    const saved = JSON.parse(readFileSync(new URL('../eval-result.json', import.meta.url), 'utf8'));
    expect(saved).toEqual(JSON.parse(JSON.stringify({ ...measured, seedSensitivity: seedSensitivity() })));
  });
});

describe('dataset sintético', () => {
  it('é reproduzível: a mesma seed gera exatamente as mesmas séries, e outra seed gera outras', () => {
    const json = (seed: number) => JSON.stringify(generateDataset(seed));
    expect(json(DEFAULT_SEED)).toBe(json(DEFAULT_SEED));
    expect(json(DEFAULT_SEED)).not.toBe(json(DEFAULT_SEED + 1));
  });

  it('tem algumas centenas de séries rotuladas, de todos os cenários legítimos e suspeitos', () => {
    const data = generateDataset();
    expect(data.length).toBeGreaterThanOrEqual(500);
    const scenarios = new Set(data.map((d) => `${d.label}:${d.scenario}`));
    expect([...scenarios].sort()).toEqual(
      [
        'legitimate:baseline',
        'legitimate:live_event',
        'legitimate:niche_noisy',
        'legitimate:organic_viral',
        'legitimate:slow_growth',
        'suspicious:bought_plateau',
        'suspicious:mechanical_drip',
        'suspicious:night_injection',
        'suspicious:step_cliff',
      ].sort(),
    );
  });

  it('a matriz de confusão soma o dataset inteiro', () => {
    const total = Object.values(measured.confusion).reduce((acc, row) => acc + row.legitimate + row.suspicious + row.inconclusive, 0);
    expect(total).toBe(measured.total);
  });
});
