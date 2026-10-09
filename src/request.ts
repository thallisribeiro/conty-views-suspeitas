// Contrato de entrada do POST /classify. A validação mora aqui para as mensagens saírem em português.

import type { HourlyViews } from './classifier';
import { DEFAULT_TIMEZONE, isValidTimezone } from './local-time';

export const MAX_HOURS = 24 * 90;
const HOUR_MS = 3_600_000;
/** Data e hora com fuso explícito: "2026-09-13T03:00:00-03:00" ou "...Z". Sem fuso, "03h" seria ambíguo. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export class InvalidRequest extends Error {}

export interface ClassifyRequest {
  series: HourlyViews[];
  timezone: string;
}

export function parseClassifyRequest(body: unknown): ClassifyRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new InvalidRequest('O corpo precisa ser um objeto JSON com o campo "series".');
  }
  const { series, timezone = DEFAULT_TIMEZONE } = body as Record<string, unknown>;

  if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
    throw new InvalidRequest(`"timezone" precisa ser um fuso IANA válido, como "America/Sao_Paulo". Recebido: ${JSON.stringify(timezone)}.`);
  }
  if (!Array.isArray(series) || series.length === 0) {
    throw new InvalidRequest('"series" precisa ser uma lista não vazia de { "hour": "...", "views": número }.');
  }
  if (series.length > MAX_HOURS) {
    throw new InvalidRequest(`"series" aceita no máximo ${MAX_HOURS} horas (90 dias). Recebido: ${series.length}.`);
  }

  const parsed = series.map((point, i): HourlyViews => {
    const where = `series[${i}]`;
    if (typeof point !== 'object' || point === null) throw new InvalidRequest(`${where} precisa ser um objeto { "hour", "views" }.`);
    const { hour, views } = point as Record<string, unknown>;
    if (typeof hour !== 'string' || !ISO_WITH_OFFSET.test(hour) || Number.isNaN(Date.parse(hour))) {
      throw new InvalidRequest(`${where}.hour precisa ser data e hora ISO 8601 com fuso, como "2026-09-13T03:00:00-03:00". Recebido: ${JSON.stringify(hour)}.`);
    }
    if (typeof views !== 'number' || !Number.isSafeInteger(views) || views < 0) {
      throw new InvalidRequest(`${where}.views precisa ser um número inteiro de views naquela hora, zero ou mais. Recebido: ${JSON.stringify(views)}.`);
    }
    return { hour: new Date(hour), views };
  });

  for (let i = 1; i < parsed.length; i++) {
    const gap = parsed[i].hour.getTime() - parsed[i - 1].hour.getTime();
    if (gap !== HOUR_MS) {
      throw new InvalidRequest(
        `series[${i}].hour precisa ser exatamente 1 hora depois de series[${i - 1}].hour, mas a diferença é de ${gap / HOUR_MS} hora(s). ` +
          'Envie horas consecutivas, em ordem, sem buracos nem repetições. Hora sem dado não deve virar zero (pareceria uma queda): envie só o trecho contínuo.',
      );
    }
  }
  return { series: parsed, timezone };
}
