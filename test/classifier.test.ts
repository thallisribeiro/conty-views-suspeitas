import { describe, expect, it } from 'vitest';
import { classify, RULES, type ClassificationResult, type SignalName } from '../src/classifier';
import {
  boughtPlateau,
  flatNormal,
  gradualRiseThenCliff,
  liveWithReplay,
  mechanicalRamp,
  organicViral,
  shortSeries,
} from '../src/samples';

const SP = 'America/Sao_Paulo';
const signal = (r: ClassificationResult, name: SignalName) => r.signals.find((s) => s.name === name)!;
const peakOf = (series: { views: number }[]) => Math.max(...series.map((p) => p.views));

describe('pico orgânico x pico comprado', () => {
  it('pico orgânico plausível e pico comprado da mesma altura caem em baldes diferentes, e os sinais mostram por quê', () => {
    const organic = organicViral();
    const bought = boughtPlateau();
    // Mesma altura (diferença menor que 5%): o que separa os dois é o formato, não o tamanho.
    expect(Math.abs(peakOf(organic) - peakOf(bought)) / peakOf(organic)).toBeLessThan(0.05);

    const a = classify(organic, SP);
    const b = classify(bought, SP);
    expect(a.classification).toBe('legitimate');
    expect(b.classification).toBe('suspicious');

    // Topo: o orgânico perde força (varia ~20%); o comprado fica parado (< 1%).
    expect(signal(a, 'flat_plateau').fired).toBe(false);
    expect(signal(a, 'flat_plateau').value!).toBeGreaterThan(0.15);
    expect(signal(b, 'flat_plateau').fired).toBe(true);
    expect(signal(b, 'flat_plateau').value!).toBeLessThan(0.01);
    // Queda: o orgânico leva horas para voltar ao normal; o comprado volta em 1 hora.
    expect(signal(a, 'cliff_drop').value!).toBeGreaterThan(RULES.cliffMaxHours);
    expect(signal(b, 'cliff_drop').value).toBe(1);
    // Madrugada: o comprado roda das 03h às 09h no mesmo nível; gente real dorme.
    expect(signal(b, 'no_day_night_cycle').fired).toBe(true);
  });

  it('subida rápida sozinha não acusa: live com replay que decai é legítima', () => {
    const r = classify(liveWithReplay(), SP);
    expect(signal(r, 'abrupt_rise').fired).toBe(true);
    expect(r.signals.filter((s) => s.fired).map((s) => s.name)).toEqual(['abrupt_rise']);
    expect(r.classification).toBe('legitimate');
    expect(r.reason).toContain('comum em live');
  });
});

describe('casos óbvios', () => {
  it('série curta (menos de 48 horas) é inconclusiva', () => {
    const r = classify(shortSeries(), SP);
    expect(r.classification).toBe('inconclusive');
    expect(r.reason).toContain('24 horas');
  });

  it('série plana normal, com ciclo de dia e noite e ruído, é legítima', () => {
    const r = classify(flatNormal(), SP);
    expect(r.classification).toBe('legitimate');
    expect(r.signals.some((s) => s.fired)).toBe(false);
  });

  it('um sinal forte sozinho dá inconclusivo: o classificador prefere não acusar', () => {
    const r = classify(gradualRiseThenCliff(), SP);
    expect(r.signals.filter((s) => s.fired).map((s) => s.name)).toEqual(['cliff_drop']);
    expect(r.classification).toBe('inconclusive');
    expect(r.reason).toContain('um sinal sozinho não basta');
  });

  it('views que sobem exatamente o mesmo tanto toda hora disparam repetição mecânica', () => {
    const r = classify(mechanicalRamp(), SP);
    expect(signal(r, 'mechanical_repetition').fired).toBe(true);
    // +150/h exatos do robô, mais ±poucas views da audiência real da conta.
    expect(signal(r, 'mechanical_repetition').description).toMatch(/subiram quase exatamente o mesmo tanto a cada hora \(1(49|50|51) por hora/);
    expect(r.classification).toBe('suspicious');
  });

  it('pico grande logo no começo da série, sem histórico antes, é inconclusivo', () => {
    const r = classify(boughtPlateau().slice(48), SP);
    expect(r.classification).toBe('inconclusive');
    expect(r.reason).toContain('primeiras horas');
  });
});

describe('explicação', () => {
  it('o motivo dá para ler sem conhecer o código: horários locais, números e nenhum nome interno', () => {
    const r = classify(boughtPlateau(), SP);
    expect(r.reason).toMatch(/^Suspeito: 4 sinais/);
    expect(r.reason).toContain('13/09 às 03h');
    expect(r.reason).toContain('variação de 0,6%');
    expect(r.reason).toContain('Audiência humana sobe e decai de forma gradual');
    expect(r.reason).not.toMatch(/[a-z]_[a-z]|null|undefined|NaN/);
  });

  it('cada sinal traz nome, valor medido, limiar, sentido do limiar e se disparou', () => {
    for (const s of classify(boughtPlateau(), SP).signals) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.threshold).toBe('number');
      expect(['<=', '>=']).toContain(s.firesWhen);
      expect(s.value === null || typeof s.value === 'number').toBe(true);
      if (s.value !== null) expect(s.fired).toBe(s.firesWhen === '<=' ? s.value <= s.threshold : s.value >= s.threshold);
      expect(s.description.length).toBeGreaterThan(20);
    }
  });

  it('madrugada é contada no fuso informado: o mesmo robô das 03h em São Paulo é 15h em Tóquio', () => {
    expect(signal(classify(boughtPlateau(), SP), 'no_day_night_cycle').fired).toBe(true);
    const tokyo = classify(boughtPlateau(), 'Asia/Tokyo');
    expect(signal(tokyo, 'no_day_night_cycle').fired).toBe(false);
    expect(tokyo.reason).toContain('13/09 às 15h');
  });
});
