import { readAppShape } from '../shared/app-shape.js';
import { nativeFetch } from '../shared/native-app.js';

declare const Bun: { serve(options: { port: number; fetch: (request: Request) => Promise<Response> }): unknown };
const port = Number(process.env.PORT);
const shape = readAppShape(process.env.BENCH_APP_SHAPE);
Bun.serve({ port, fetch: (request) => nativeFetch(shape, request) });
console.log(`native+Bun listening on :${port}`);
