import type { AppShape } from '../scenarios';

export function readAppShape(raw: string = 'read-search-local'): AppShape {
  if (raw === 'read-search-local' || raw === 'json-command-local' || raw === 'rest-route-mix-local') return raw;
  throw new Error(`Unsupported BENCH_APP_SHAPE: ${raw}`);
}
