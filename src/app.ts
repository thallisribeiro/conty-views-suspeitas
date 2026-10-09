import Fastify, { type FastifyError } from 'fastify';
import { classify } from './classifier';
import { InvalidRequest, parseClassifyRequest } from './request';

export function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });

  app.post('/classify', async (request) => {
    const { series, timezone } = parseClassifyRequest(request.body);
    return { ...classify(series, timezone), timezone, hours: series.length };
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: `Rota ${request.method} ${request.url} não existe. Use POST /classify.` }),
  );

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof InvalidRequest) return reply.code(400).send({ error: error.message });
    if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return reply.code(415).send({ error: 'Envie o corpo como JSON, com Content-Type: application/json.' });
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'Corpo grande demais (limite de 1 MB).' });
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'O corpo precisa ser um JSON válido.' });
    }
    reply.log.error(error);
    return reply.code(500).send({ error: 'Erro interno ao classificar a série.' });
  });

  return app;
}
