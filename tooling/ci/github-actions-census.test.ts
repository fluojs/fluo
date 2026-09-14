import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCensus,
  classifyAttempt,
  parseBounds,
  parseCensusArgs,
} from './github-actions-census.mjs';

const fixturePath = fileURLToPath(new URL('./fixtures/github-actions-census-replay.json', import.meta.url));
const cliPath = fileURLToPath(new URL('./github-actions-census.mjs', import.meta.url));

describe('GitHub Actions census', () => {
  it('preserves all attempts, failed cancelled jobs, zero-job states, and raw provenance', () => {
    // Given
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    // When
    const census = buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00Z',
      until: '2026-09-15T00:00:00Z',
      workflow: 'CI',
    });

    // Then
    expect(census.attempts).toHaveLength(6);
    expect(census.attempts.map((attempt) => attempt.classification.kind)).toEqual([
      'failure-bearing',
      'non-failure',
      'failure-bearing',
      'zero-job-approval',
      'zero-job-action-required',
      'zero-job-cancelled',
    ]);
    expect(census.attempts[0]?.jobs).toHaveLength(2);
    expect(census.attempts[0]?.jobs[0]?.steps).toHaveLength(2);
    expect(census.attempts[2]?.run.conclusion).toBe('cancelled');
    expect(census.attempts[1]?.jobs[0]?.conclusion).toBe('unknown_vendor_state');
    expect(census.observedAt).toBe('2026-09-14T12:30:00.000Z');
    expect(census.limits).toContain('Deleted or retention-expired GitHub Actions records cannot be recovered.');
  });

  it('groups repeated underlying failures and marks Verify as derived without deleting raw evidence', () => {
    // Given
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

    // When
    const census = buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00Z',
      until: '2026-09-15T00:00:00Z',
      workflow: 'CI',
    });

    // Then
    expect(census.summary.failureBearingAttempts).toBe(2);
    expect(census.summary.signatures).toHaveLength(2);
    expect(census.summary.signatures[0]?.occurrences).toHaveLength(2);
    expect(census.summary.derivedAggregateOccurrences).toHaveLength(1);
    expect(census.summary.derivedAggregateOccurrences[0]?.job.name).toBe('Verify');
    expect(census.summary.signatures[0]?.occurrences[0]?.urls).toMatchObject({
      attempt: expect.stringContaining('/attempts/1'),
      job: expect.stringContaining('/job/201'),
      run: expect.stringContaining('/runs/100'),
    });
  });

  it('uses numeric half-open timestamps and rejects malformed scopes', () => {
    // Given
    const fixture = {
      attempts: [{
        created_at: '2026-09-14T00:00:00Z',
        jobs: [],
        run_attempt: 1,
        run_id: 1,
      }],
      workflow_runs: [{
        created_at: '2026-09-14T00:00:00Z',
        id: 1,
        run_attempt: 1,
      }],
    };

    // When
    const census = buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-13T23:59:59.500Z',
      until: '2026-09-14T00:00:00.500Z',
      workflow: 'CI',
    });

    // Then
    expect(census.attempts).toHaveLength(1);
    expect(parseBounds('2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z').since)
      .toBe('2026-09-14T00:00:00.000Z');
    expect(() => parseCensusArgs(['--owner', 'fluojs', '--repo', 'fluo', '--workflow', 'CI', '--since', 'bad', '--until', '2026-09-15T00:00:00Z']))
      .toThrow(/UTC/u);
    expect(() => parseCensusArgs(['--owner', '../fluo', '--repo', 'fluo', '--workflow', 'CI', '--since', '2026-09-14T00:00:00Z', '--until', '2026-09-15T00:00:00Z']))
      .toThrow(/owner/u);
  });

  it('does not acquire GitHub data while replaying a fixture through the CLI', () => {
    // Given
    const execute = vi.fn();

    // When
    const result = spawnSync(process.execPath, [
      cliPath,
      '--owner', 'fluojs',
      '--repo', 'fluo',
      '--workflow', 'CI',
      '--input', fixturePath,
      '--since', '2026-09-14T00:00:00Z',
      '--until', '2026-09-15T00:00:00Z',
    ], { encoding: 'utf8' });

    // Then
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).summary.derivedAggregateOccurrences).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('classifies completed failed jobs before zero-job cancellation handling', () => {
    // Given
    const attempt = {
      conclusion: 'cancelled',
      jobs: [{ completed_at: '2026-09-14T00:00:01Z', conclusion: 'failure', id: 1, name: 'test' }],
      run_attempt: 1,
    };

    // When
    const classification = classifyAttempt(attempt);

    // Then
    expect(classification.kind).toBe('failure-bearing');
  });
});
