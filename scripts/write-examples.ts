// npm run examples: grava as séries de src/samples.ts como corpos prontos para o POST /classify.

import { mkdirSync, writeFileSync } from 'node:fs';
import type { HourlyViews } from '../src/classifier';
import { boughtPlateau, gradualRiseThenCliff, organicViral } from '../src/samples';

const offset = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 19) + '-03:00';
const body = (series: HourlyViews[]) => ({
  timezone: 'America/Sao_Paulo',
  series: series.map((p) => ({ hour: offset(p.hour), views: p.views })),
});

mkdirSync('examples', { recursive: true });
const examples = { 'pico-organico': organicViral(), 'pico-comprado': boughtPlateau(), 'nao-acusa': gradualRiseThenCliff() };
for (const [name, series] of Object.entries(examples)) {
  writeFileSync(`examples/${name}.json`, `${JSON.stringify(body(series))}\n`);
  console.log(`examples/${name}.json (${series.length} horas)`);
}
