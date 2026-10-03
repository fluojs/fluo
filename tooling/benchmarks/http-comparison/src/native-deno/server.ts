import process from 'node:process';
import { readAppShape } from '../shared/app-shape.js';
import { nativeFetch } from '../shared/native-app.js';

declare const Deno: { serve(options: { port: number; hostname: string; onListen: () => void }, handler: (request: Request) => Promise<Response>): unknown };
const port = Number(process.argv[2]);
const shape = readAppShape(process.argv[3]);
Deno.serve({ port, hostname: process.env.BENCH_BIND_HOST ?? '127.0.0.1', onListen: () => console.log(`native+Deno listening on :${port}`) }, (request) => nativeFetch(shape, request));
