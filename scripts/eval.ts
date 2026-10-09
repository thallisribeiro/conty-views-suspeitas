// npm run eval: gera o dataset (seed fixa), classifica tudo, imprime a matriz e grava eval-result.json.

import { writeFileSync } from 'node:fs';
import { evaluate, seedSensitivity } from '../src/evaluate';
import { formatPercent } from '../src/local-time';

const result = evaluate();
const sensitivity = seedSensitivity();
const pad = (s: string | number, n: number) => String(s).padStart(n);
const cols = ['legitimate', 'suspicious', 'inconclusive'] as const;

console.log(`Dataset sintético: ${result.total} séries (seed ${result.seed})\n`);
console.log(`${'rótulo \\ classificado'.padEnd(22)}${cols.map((c) => pad(c, 14)).join('')}`);
for (const label of ['legitimate', 'suspicious'] as const) {
  console.log(`${label.padEnd(22)}${cols.map((c) => pad(result.confusion[label][c], 14)).join('')}`);
}
console.log('\nPor cenário:');
for (const [scenario, row] of Object.entries(result.byScenario)) {
  console.log(`  ${scenario.padEnd(18)} (${row.label.padEnd(10)})${cols.map((c) => pad(row[c], 6)).join('')}`);
}
console.log(`\nTaxa de falso positivo (legítimos acusados ÷ legítimos): ${formatPercent(result.falsePositiveRate)}`);
console.log(`Taxa de detecção (suspeitos acusados ÷ suspeitos):       ${formatPercent(result.detectionRate)}`);
console.log(
  `Inconclusivos: ${formatPercent(result.inconclusiveRate.legitimate)} dos legítimos, ${formatPercent(result.inconclusiveRate.suspicious)} dos suspeitos`,
);
if (result.falsePositives.length) console.log(`Falsos positivos: ${result.falsePositives.join(', ')}`);
if (result.missedAsLegitimate.length) console.log(`Suspeitos que passaram como legítimos: ${result.missedAsLegitimate.join(', ')}`);
const { falsePositiveRate: fp, detectionRate: det } = sensitivity;
console.log(
  `\nCom as seeds ${sensitivity.seeds[0]} a ${sensitivity.seeds[sensitivity.seeds.length - 1]}: falso positivo de ${formatPercent(fp.min)} a ${formatPercent(fp.max)}, detecção de ${formatPercent(det.min)} a ${formatPercent(det.max)}`,
);

writeFileSync('eval-result.json', `${JSON.stringify({ ...result, seedSensitivity: sensitivity }, null, 2)}\n`);
console.log('\nGravado em eval-result.json');
