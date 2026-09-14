import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCensus,
  classifyAttempt,
  parseBounds,
  parseCensusArgs,
} from './github-actions-census.mjs';
import { collectGithubActionsCensus } from './github-actions-census-github.mjs';

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
      'unknown',
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

  it.each([
    [{ conclusion: 'failure', jobs: [] }, 'zero-job-failure'],
    [{ conclusion: 'timed_out', jobs: [] }, 'zero-job-timed-out'],
    [{ conclusion: 'unknown_vendor_state', jobs: [] }, 'zero-job-unknown'],
    [{ conclusion: 'success', jobs: [{ completed_at: '2026-09-14T00:00:01Z', conclusion: 'unknown_vendor_state' }] }, 'unknown'],
  ])('does not silently classify incomplete attempt state as non-failure', (attempt, kind) => {
    expect(classifyAttempt(attempt).kind).toBe(kind);
  });

  it('collects each attempt detail and attempt-specific jobs with GET and created bounds', () => {
    const calls: string[][] = [];
    const run = {
      conclusion: 'success',
      created_at: '2026-09-14T00:00:00Z',
      html_url: 'https://github.test/runs/1',
      id: 1,
      run_attempt: 2,
    };
    const responses = new Map<string, unknown>([
      ['runs', { total_count: 1, workflow_runs: [run] }],
      ['attempt-1', { ...run, conclusion: 'failure', run_attempt: 1 }],
      ['attempt-2', { ...run, conclusion: 'success', run_attempt: 2 }],
      ['jobs-1', { total_count: 1, jobs: [{ completed_at: '2026-09-14T00:01:00Z', conclusion: 'failure', id: 11, name: 'Test' }] }],
      ['jobs-2', { total_count: 1, jobs: [{ completed_at: '2026-09-14T00:02:00Z', conclusion: 'success', id: 12, name: 'Test' }] }],
    ]);
    const execute = (_command: string, args: readonly string[]) => {
      calls.push([...args]);
      const endpoint = args.at(-1) ?? '';
      if (endpoint.includes('/workflows/CI/runs?')) return JSON.stringify(responses.get('runs'));
      if (endpoint.endsWith('/attempts/1')) return JSON.stringify(responses.get('attempt-1'));
      if (endpoint.endsWith('/attempts/2')) return JSON.stringify(responses.get('attempt-2'));
      if (endpoint.endsWith('/attempts/1/jobs?per_page=100')) return JSON.stringify(responses.get('jobs-1'));
      if (endpoint.endsWith('/attempts/2/jobs?per_page=100')) return JSON.stringify(responses.get('jobs-2'));
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    };

    const census = collectGithubActionsCensus({
      execFileSync: execute,
      observedAt: () => '2026-09-14T03:00:00Z',
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00.000Z',
      until: '2026-09-15T00:00:00.000Z',
      workflow: 'CI',
    });

    expect(census.attempts.map((attempt) => attempt.conclusion)).toEqual(['failure', 'success']);
    expect(census.attempts.map((attempt) => attempt.jobs[0]?.id)).toEqual([11, 12]);
    expect(calls.every((args) => args.includes('--method') && args.includes('GET'))).toBe(true);
    expect(calls[0]?.at(-1)).toContain('created=');
  });

  it('rejects calendar-normalized UTC dates', () => {
    expect(() => parseBounds('2026-02-31T00:00:00Z', '2026-03-02T00:00:00Z')).toThrow(/UTC/u);
  });

  it('keeps timeout and failure conclusions in separate root signatures', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    fixture.attempts[2].jobs[0].conclusion = 'timed_out';
    fixture.attempts[2].jobs[0].steps[0].conclusion = 'timed_out';

    const census = buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00Z',
      until: '2026-09-15T00:00:00Z',
      workflow: 'CI',
    });

    expect(census.summary.signatures).toHaveLength(3);
  });

  it('deduplicates equivalent package and tooling shard failures without losing occurrences', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    fixture.workflow_runs.push({
      conclusion: 'failure',
      created_at: '2026-09-14T12:20:00.000Z',
      html_url: 'https://github.com/fluojs/fluo/actions/runs/105',
      id: 105,
      run_attempt: 1,
    });
    fixture.attempts.push({
      conclusion: 'failure',
      created_at: '2026-09-14T12:20:00.000Z',
      jobs: [{
        completed_at: '2026-09-14T12:21:00.000Z',
        conclusion: 'failure',
        html_url: 'https://github.com/fluojs/fluo/actions/runs/105/job/206',
        id: 206,
        name: 'Node support (24.0.0) / Test (tooling-2)',
        steps: [{ conclusion: 'failure', name: 'Run test', number: 1 }],
      }],
      run_attempt: 1,
      run_id: 105,
    });

    const census = buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00Z',
      until: '2026-09-15T00:00:00Z',
      workflow: 'CI',
    });

    expect(census.summary.signatures).toHaveLength(2);
    expect(census.summary.signatures[0]?.occurrences).toHaveLength(3);
  });

  it('rejects conflicting records for the same run attempt', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
    fixture.attempts.push({ ...fixture.attempts[0], conclusion: 'success' });

    expect(() => buildCensus({
      input: fixture,
      owner: 'fluojs',
      repo: 'fluo',
      since: '2026-09-14T00:00:00Z',
      until: '2026-09-15T00:00:00Z',
      workflow: 'CI',
    })).toThrow(/conflicting attempt/u);
  });
});
