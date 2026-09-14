import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  acquireBuildArtifact,
  classifyAcquisitionFailure,
  main,
  validateArtifactMetadata,
} from './acquire-build-artifact.mjs';

const bytes = Buffer.from('artifact payload');
const expected = {
  digest: createHash('sha256').update(bytes).digest('hex'),
  id: 1,
  name: 'node-build',
  runId: 2,
  sha: 'b'.repeat(40),
};
const metadata = { ...expected, workflow_run: { head_sha: expected.sha, id: expected.runId } };

describe('build artifact acquisition', () => {
  it('retries only intermediary 403 and explicit acquisition 5xx statuses', () => {
    expect(classifyAcquisitionFailure({ status: 403, text: 'upstream request timeout through intermediary' }).retry).toBe(true);
    expect(classifyAcquisitionFailure({ status: 503, text: 'service unavailable' }).retry).toBe(true);
    expect(classifyAcquisitionFailure({ status: 403, text: 'forbidden' }).retry).toBe(false);
    expect(classifyAcquisitionFailure({ status: 401, text: 'bad credentials' }).retry).toBe(false);
  });

  it('rejects artifact identity or digest mismatch before restore', () => {
    expect(validateArtifactMetadata(metadata, expected)).toBe(true);
    expect(validateArtifactMetadata({ ...metadata, digest: `sha256:${expected.digest}` }, expected)).toBe(true);
    expect(() => validateArtifactMetadata({ ...metadata, digest: 'c'.repeat(64) }, expected)).toThrow(/digest/u);
  });

  it('uses the bounded retry path for a transient metadata failure and reports provenance', async () => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-artifact-'));
    const outputPath = join(directory, 'node-build.tar');
    let metadataCalls = 0;
    const fetch = async (url: string) => {
      if (url === 'metadata' && metadataCalls++ === 0) return new Response('intermediary timeout', { status: 403 });
      if (url === 'metadata') return new Response(JSON.stringify(metadata), { status: 200 });
      return new Response(bytes, { status: 200 });
    };

    // When
    const result = await acquireBuildArtifact({
      expected: { ...expected, downloadUrl: 'download', metadataUrl: 'metadata' },
      fetch,
      now: () => 0,
      outputPath,
    });

    // Then
    expect(result).toMatchObject({ attempt: 2, digest: expected.digest, outputPath });
    expect(readFileSync(outputPath)).toEqual(bytes);
    rmSync(directory, { force: true, recursive: true });
  });

  it('runs CLI acquisition through the same bounded retry helper', async () => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-artifact-cli-'));
    const output: string[] = [];
    const fetch = async (url: string) => {
      if (url === 'metadata') return new Response(JSON.stringify(metadata), { status: 200 });
      return new Response(bytes, { status: 200 });
    };

    // When
    try {
      await main([
        '--id', '1', '--digest', expected.digest, '--sha', expected.sha, '--name', expected.name, '--run-id', '2', '--output', join(directory, 'node-build.tar'),
    ], {
      extract: () => {},
      fetch,
      metadataUrl: 'metadata',
      downloadUrl: 'download',
      repository: 'fluojs/fluo',
      writeOutput: (value: string) => output.push(value),
    });

      // Then
      expect(JSON.parse(output.join(''))).toMatchObject({ artifactId: 1, digest: expected.digest, name: expected.name, sha: expected.sha });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('requires a token for the real GitHub adapter', async () => {
    await expect(main([
      '--id', '1', '--digest', expected.digest, '--sha', expected.sha, '--name', expected.name, '--run-id', '2', '--output', '/tmp/no-token-artifact',
    ], {
      repository: 'fluojs/fluo',
    })).rejects.toThrow(/GH_TOKEN or GITHUB_TOKEN/u);
  });

  it('writes redacted attempt evidence for an exhausted acquisition', async () => {
    // Given
    const directory = mkdtempSync(join(tmpdir(), 'fluo-artifact-summary-'));
    const summaryPath = join(directory, 'summary.jsonl');

    // When
    try {
      await expect(main([
        '--id', '1', '--digest', expected.digest, '--sha', expected.sha, '--name', expected.name, '--run-id', '2', '--output', join(directory, 'node-build.tar'),
      ], {
        fetch: async () => new Response('upstream intermediary timeout', { status: 503 }),
        metadataUrl: 'https://api.github.test/metadata?signed=secret',
        downloadUrl: 'https://objects.test/download?signed=secret',
        repository: 'fluojs/fluo',
        summaryPath,
      })).rejects.toThrow(/metadata request failed/u);

      // Then
      const summary = readFileSync(summaryPath, 'utf8');
      expect(summary).toContain('"outcome":"failed"');
      expect(summary).toContain('"status":503');
      expect(summary).not.toContain('signed=secret');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
