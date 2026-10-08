import type { NextApiRequest, NextApiResponse } from 'next';
import { readAppShape } from '../../../../dist/next-native/shared/app-shape.js';
import { comparisonHeaders } from '../../../../dist/next-native/shared/comparison-headers.js';
import { nativeResponse } from '../../../../dist/next-native/shared/native-app.js';

// Next owns parsing and the socket. No Fluo adapter or Web transport bridge.
export default function handler(request: NextApiRequest, response: NextApiResponse) {
  const url = new URL(request.url ?? '/', 'http://next.local');
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/';
  const result = nativeResponse(readAppShape(process.env.BENCH_APP_SHAPE), request.method ?? '', url, request.body);
  response.setHeader('content-type', 'application/json');
  for (const [name, value] of Object.entries(comparisonHeaders(process.env.BENCH_CONFIGURATION))) {
    response.setHeader(name, value);
  }
  response.status(result.status).end(result.body);
}
