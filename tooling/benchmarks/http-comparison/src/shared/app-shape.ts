import { isStageShape, type StageShape } from './stage-workloads.js';

export type AppShape = 'read-search-local' | 'json-command-local' | 'rest-route-mix-local' | StageShape;

export function readAppShape(raw: string = 'read-search-local'): AppShape {
  if (raw === 'read-search-local' || raw === 'json-command-local' || raw === 'rest-route-mix-local' || isStageShape(raw)) return raw;
  throw new Error(`Unsupported BENCH_APP_SHAPE: ${raw}`);
}
