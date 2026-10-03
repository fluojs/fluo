import { createServer } from 'node:http';
import { readAppShape } from '../shared/app-shape.js';
import { comparisonHeaders } from '../shared/comparison-headers.js';
import { nativeResponse } from '../shared/native-app.js';

const port = Number(process.env.PORT);
const shape = readAppShape(process.env.BENCH_APP_SHAPE);
const server = createServer(async (request, response) => {
  try {
    let body = '';
    for await (const chunk of request) {
      body += String(chunk);
      if (Buffer.byteLength(body) > 1_048_576) { response.writeHead(413); response.end(); return; }
    }
    const result = nativeResponse(shape, request.method ?? '', new URL(request.url ?? '/', 'http://localhost'), body === '' ? undefined : JSON.parse(body));
    response.writeHead(result.status, { 'content-type': 'application/json', ...comparisonHeaders(process.env.BENCH_CONFIGURATION) });
    response.end(result.body);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    response.writeHead(400); response.end(JSON.stringify({ error: error.message }));
  }
});
server.listen(port, process.env.BENCH_BIND_HOST ?? '127.0.0.1', () => console.log(`native+Node listening on :${port}`));
