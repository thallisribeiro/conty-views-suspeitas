// Hora local e formatação em pt-BR. O fuso importa porque "madrugada" é no relógio de quem assiste.

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
const labelFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(map: Map<string, Intl.DateTimeFormat>, timezone: string, options: Intl.DateTimeFormatOptions) {
  let formatter = map.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, ...options });
    map.set(timezone, formatter);
  }
  return formatter;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Hora do dia (0–23) no fuso informado. */
export function localHour(date: Date, timezone: string): number {
  const formatter = cached(hourFormatters, timezone, { hour: 'numeric', hourCycle: 'h23' });
  return Number(formatter.format(date));
}

/** "12/10 às 03h" */
export function formatWhen(date: Date, timezone: string): string {
  const parts = cached(labelFormatters, timezone, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')} às ${get('hour')}h`;
}

const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export const formatInt = (n: number) => integer.format(Math.round(n));
export const formatDecimal = (n: number, digits = 1) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(n);
/** 0.0241 → "2,4%" (sempre uma casa, para o README poder ser comparado com o medido). */
export const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(1).replace('.', ',')}%`;
