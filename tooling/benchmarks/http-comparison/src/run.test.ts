import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  createBenchmarkMetadata,
  readFluoSource,
  selectTargetConfigs,
  type BenchmarkTargetConfig,
} from './runner-options';

const runSourcePath = fileURLToPath(new URL('./run.ts', import.meta.url));
const benchmarkTargets = [
  {
    args: ['dist/nestjs/nestjs/server.js'],
    command: 'node',
    label: 'Nest+Fastify',
    name: 'nestjs-fastify',
    port: 3002,
  },
  {
    args: ['dist/fluo-fastify/fluo/server.js'],
    command: 'node',
    label: 'fluo+Fastify',
    name: 'fluo-fastify',
    port: 3001,
  },
  {
    args: ['run', 'dist/fluo-bun/fluo-bun/server.js'],
    command: 'bun',
    label: 'fluo+Bun',
    name: 'fluo-bun',
    port: 3003,
  },
  {
    args: ['dist/nestjs/nestjs/server.js'],
    command: 'node',
    label: 'Nest+Express',
    name: 'nestjs-express',
    port: 3004,
  },
  {
    args: ['dist/fluo-fastify/fluo/server.js'],
    command: 'node',
    label: 'fluo+Express',
    name: 'fluo-express',
    port: 3005,
  },
] satisfies readonly BenchmarkTargetConfig[];

describe('HTTP benchmark runner defaults', () => {
  it('keeps the published benchmark default target set unchanged', () => {
    const source = readFileSync(runSourcePath, 'utf8');

    expect(source).toContain("label: 'Nest+Fastify'");
    expect(source).toContain("label: 'fluo+Fastify'");
    expect(source).toContain("label: 'Nest+Express'");
    expect(source).toContain("label: 'fluo+Express'");
    expect(source).toContain("label: 'fluo+Bun'");
  });
});

describe('HTTP benchmark runner options', () => {
  it('filters benchmark targets when BENCH_TARGETS selects Fastify-only comparison', () => {
    const selected = selectTargetConfigs(
      { BENCH_TARGETS: 'nestjs-fastify,fluo-fastify' },
      benchmarkTargets,
    );

    expect(selected.map((target) => target.name)).toEqual([
      'nestjs-fastify',
      'fluo-fastify',
    ]);
  });

  it('filters benchmark targets when BENCH_TARGETS selects Express-only comparison', () => {
    const selected = selectTargetConfigs(
      { BENCH_TARGETS: 'nestjs-express,fluo-express' },
      benchmarkTargets,
    );

    expect(selected.map((target) => target.name)).toEqual([
      'nestjs-express',
      'fluo-express',
    ]);
  });

  it('rejects unknown benchmark targets with a clear error', () => {
    expect(() => selectTargetConfigs(
      { BENCH_TARGETS: 'unknown' },
      benchmarkTargets,
    )).toThrow('Unknown BENCH_TARGETS entries: unknown');
  });

  it('labels local tarball results without changing published-package defaults', () => {
    expect(readFluoSource({})).toBe('published');
    expect(readFluoSource({ BENCH_FLUO_SOURCE: 'local-tarball' })).toBe('local-tarball');
  });

  it('writes published-baseline and local-before artifact metadata', () => {
    const metadata = createBenchmarkMetadata({
      artifactLabel: 'local-before',
      fluoSource: 'local-tarball',
      targets: benchmarkTargets.slice(0, 2),
    });

    expect(metadata).toEqual({
      artifactLabel: 'local-before',
      fluoSource: 'local-tarball',
      selectedTargets: ['nestjs-fastify', 'fluo-fastify'],
    });
  });
});
