// Séries de exemplo com formato escolhido à mão. Os testes usam estas, e `npm run examples` grava as mesmas
// em examples/*.json para o curl do README. Todas começam à meia-noite de 11/09/2026 em São Paulo.

import type { HourlyViews } from './classifier';
import { DAILY, createRng, localMidnight, render, viralPulse } from './dataset';

const START = localMidnight(10);
const BASE = 120;
/** Índice da hora `h` (hora local) do dia `day` da série. */
const at = (day: number, h: number) => 24 * day + h;

function channel(hours: number, extra: (i: number) => number = () => 0, bot?: (i: number) => number): HourlyViews[] {
  const botNoise = createRng(7);
  return render(createRng(42), {
    hours,
    start: START,
    noise: 0.15,
    human: (i, h) => (BASE + extra(i)) * DAILY[h],
    bot: bot && ((i) => bot(i) * (1 + 0.01 * botNoise.normal())),
  });
}

/** Viral orgânico: começa às 14h do 3º dia, sobe em 4 horas, perde metade da força a cada 5 horas. */
export function organicViral(): HourlyViews[] {
  return channel(120, (i) => 6000 * viralPulse(i, at(2, 14), 4, 5));
}

/** O mesmo canal, com um pico comprado da mesma altura: 03h às 09h do 3º dia, liga e desliga de uma vez. */
export function boughtPlateau(): HourlyViews[] {
  const height = Math.max(...organicViral().map((p) => p.views));
  return channel(120, undefined, (i) => (i >= at(2, 3) && i < at(2, 9) ? height : 0));
}

/** Live às 20h do 3º dia: entra de uma vez (40× o normal), dura 2 horas, o replay decai aos poucos. */
export function liveWithReplay(): HourlyViews[] {
  const begin = at(2, 20);
  const end = at(2, 22);
  return render(createRng(42), {
    hours: 96,
    start: START,
    noise: 0.15,
    human: (i, h) => {
      if (i >= begin && i < end) return 40 * BASE;
      const replay = i >= end ? 40 * BASE * 0.4 * 0.5 ** ((i - end) / 2) : 0;
      return (BASE + replay) * DAILY[h];
    },
  });
}

/**
 * Caso em que o classificador prefere não acusar: sobe aos poucos a partir das 14h, oscila como gente no topo,
 * mas some de uma vez à meia-noite. Só a queda abrupta dispara.
 */
export function gradualRiseThenCliff(): HourlyViews[] {
  const begin = at(2, 14);
  return render(createRng(42), {
    hours: 96,
    start: START,
    noise: 0.15,
    human: (i, h) => BASE * DAILY[h] + (i >= begin && i < begin + 10 ? 3000 * Math.min(1, ((i - begin + 1) / 5) ** 2) : 0),
  });
}

/** Conta pequena (~8 views/h) com entrega programada: começa em 200/h e sobe exatamente 150 a cada hora, por 12 horas. */
export function mechanicalRamp(): HourlyViews[] {
  const begin = at(2, 8);
  return render(createRng(42), {
    hours: 96,
    start: START,
    noise: 0.15,
    human: (_, h) => 8 * DAILY[h],
    bot: (i) => (i >= begin && i < begin + 12 ? 200 + 150 * (i - begin) : 0),
  });
}

/** Rotina de um canal médio: 3 dias de ciclo diário e ruído, sem evento. */
export function flatNormal(): HourlyViews[] {
  return render(createRng(42), { hours: 72, start: START, noise: 0.15, human: (_, h) => 300 * DAILY[h] });
}

/** Só 24 horas: pouco para saber o que é normal no canal. */
export function shortSeries(): HourlyViews[] {
  return flatNormal().slice(0, 24);
}
