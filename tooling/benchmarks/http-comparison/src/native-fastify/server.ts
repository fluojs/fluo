import fastify from 'fastify';
import { readAppShape } from '../shared/app-shape.js';
import { comparisonHeaders } from '../shared/comparison-headers.js';
import { nativeResponse } from '../shared/native-app.js';

const port = Number(process.env.PORT);
const shape = readAppShape(process.env.BENCH_APP_SHAPE);
const server = fastify();
server.all('/*', (request, reply) => {
  const result = nativeResponse(shape, request.method, new URL(request.url, 'http://localhost'), request.body);
  return reply.headers(comparisonHeaders(process.env.BENCH_CONFIGURATION)).code(result.status).type('application/json').send(result.body);
});
await server.listen({ port, host: process.env.BENCH_BIND_HOST ?? '127.0.0.1' });
console.log(`native+Fastify listening on :${port}`);
