import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { boughtPlateau, organicViral } from '../src/samples';

const app = buildApp();
afterAll(() => app.close());

const toBody = (series: { hour: Date; views: number }[]) => ({
  series: series.map((p) => ({ hour: p.hour.toISOString(), views: p.views })),
});
const post = (payload: unknown) => app.inject({ method: 'POST', url: '/classify', payload: payload as object });

describe('POST /classify', () => {
  it('classifica pela API: pico comprado vem suspeito, com motivo e sinais', async () => {
    const res = await post(toBody(boughtPlateau()));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.classification).toBe('suspicious');
    expect(body.reason).toMatch(/^Suspeito/);
    expect(body.timezone).toBe('America/Sao_Paulo');
    expect(body.hours).toBe(120);
    expect(body.signals.map((s: { name: string }) => s.name)).toEqual([
      'abrupt_rise',
      'flat_plateau',
      'cliff_drop',
      'mechanical_repetition',
      'no_day_night_cycle',
    ]);
  });

  it('classifica pela API: pico orgânico vem legítimo', async () => {
    const res = await post(toBody(organicViral()));
    expect(res.statusCode).toBe(200);
    expect(res.json().classification).toBe('legitimate');
  });

  it('aceita o fuso informado e usa nos horários do motivo', async () => {
    const res = await post({ ...toBody(boughtPlateau()), timezone: 'Asia/Tokyo' });
    expect(res.json().reason).toContain('às 15h');
  });

  it('rejeita série com buraco de horas, com mensagem em português que diz onde', async () => {
    const body = toBody(boughtPlateau());
    body.series.splice(10, 1);
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('series[10].hour precisa ser exatamente 1 hora depois de series[9].hour');
  });

  it('rejeita hora sem fuso, views negativas ou quebradas, fuso inválido e corpo vazio', async () => {
    const cases: [unknown, string][] = [
      [{ series: [{ hour: '2026-09-13T03:00:00', views: 1 }] }, 'com fuso'],
      [{ series: [{ hour: '2026-09-13T03:30:00Z', views: 1 }] }, 'minutos zerados'],
      [{ series: [{ hour: '2026-02-30T03:00:00Z', views: 1 }] }, 'data que existe'],
      [{ series: [{ hour: '2026-09-13T03:00:00Z', views: -1 }] }, 'zero ou mais'],
      [{ series: [{ hour: '2026-09-13T03:00:00Z', views: 1.5 }] }, 'inteiro'],
      [{ series: [{ hour: '2026-09-13T03:00:00Z', views: 1 }], timezone: 'Marte/Olympus' }, 'fuso IANA'],
      [{ series: [] }, 'lista não vazia'],
      [{}, 'lista não vazia'],
    ];
    for (const [payload, message] of cases) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain(message);
    }
  });

  it('rota inexistente responde 404 em português', async () => {
    const res = await app.inject({ method: 'GET', url: '/classify' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Rota GET /classify não existe. Use POST /classify.');
  });

  it('rejeita JSON malformado com mensagem em português', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/classify',
      headers: { 'content-type': 'application/json' },
      payload: '{"series": [',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('O corpo precisa ser um JSON válido.');
  });
});
