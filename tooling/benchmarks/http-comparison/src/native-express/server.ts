import express from 'express';
import { readAppShape } from '../shared/app-shape.js';
import { comparisonHeaders } from '../shared/comparison-headers.js';
import { nativeResponse } from '../shared/native-app.js';

const port = Number(process.env.PORT);
const shape = readAppShape(process.env.BENCH_APP_SHAPE);
const server = express();
server.use(express.json());
server.use((request, response) => {
  const result = nativeResponse(shape, request.method, new URL(request.url, 'http://localhost'), request.body);
  response.set(comparisonHeaders(process.env.BENCH_CONFIGURATION)).status(result.status).type('application/json').send(result.body);
});
server.listen(port, process.env.BENCH_BIND_HOST ?? '127.0.0.1', () => console.log(`native+Express listening on :${port}`));
