import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { LaneLedgerFixture } from './verify-lane-ledger.test-support';
import {
  fixtureDir,
  runMutatedCompletedLedger,
  runMutatedReadyLedger,
  runValidatorPath,
} from './verify-lane-ledger.test-support';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDir}/${name}`, 'utf8'));
}

function structuralDiff(left: unknown, right: unknown, path = ''): string[] {
  if (Object.is(left, right)) {
    return [];
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const indexes = new Set([...left.keys(), ...right.keys()]);
    return [...indexes].flatMap((index) => structuralDiff(left[index], right[index], `${path}[${String(index)}]`));
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftRecord = Object.fromEntries(Object.entries(left));
    const rightRecord = Object.fromEntries(Object.entries(right));
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    return [...keys].flatMap((key) => structuralDiff(leftRecord[key], rightRecord[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

describe('lane ledger invalid fixture isolation', () => {
  const validReady = readFixture('valid-ready.json');

  it.each([
    ['invalid-merge-method.json', ['pr_merge_method']],
    ['invalid-missing-merge-method.json', ['pr_merge_method']],
    ['invalid-pr-merge-false.json', ['authority_scope.pr_merge']],
  ])('keeps %s limited to its named violation', (fixture, expectedDiff) => {
    expect(structuralDiff(validReady, readFixture(fixture))).toEqual(expectedDiff);
  });
});

describe('lane ledger canonical schema', () => {
  it.each([
    ['lane_id', 'run_id and lane_id must be matching path-safe basenames', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger, 'lane_id')],
    ['source', 'source must match a canonical source variant', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger, 'source')],
    ['suggested_but_excluded', 'suggested_but_excluded must be an array', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger, 'suggested_but_excluded')],
    ['backlog_candidates', 'backlog_candidates must be an array', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger, 'backlog_candidates')],
    ['dependency_graph', 'dependency_graph must be an object', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger, 'dependency_graph')],
  ])('rejects a missing root key %s', (_key, expectedError, mutate) => {
    expect(runMutatedReadyLedger(mutate)).toContain(expectedError);
  });

  it('rejects an unknown root key', () => {
    expect(runMutatedReadyLedger((ledger) => Object.assign(ledger, { legacy: true }))).toContain(
      'ledger must contain exactly the canonical root keys',
    );
  });

  it.each(['', '../lane', 'nested/lane', '.hidden', 'lane.lock'])('rejects unsafe run and lane identity %s', (identity) => {
    expect(
      runMutatedReadyLedger((ledger) => {
        ledger.run_id = identity;
        ledger.lane_id = identity;
      }),
    ).toContain('run_id and lane_id must be matching path-safe basenames');
  });

  it('rejects mismatched run and lane identity', () => {
    expect(runMutatedReadyLedger((ledger) => (ledger.lane_id = 'other-lane'))).toContain(
      'run_id and lane_id must be matching path-safe basenames',
    );
  });

  it.each(['2026-08-01', '2026-08-01T00:00:00+00:00', '2026-02-30T00:00:00Z'])('rejects malformed created_at %s', (createdAt) => {
    expect(runMutatedReadyLedger((ledger) => (ledger.created_at = createdAt))).toContain('created_at must be a strict UTC ISO-8601 timestamp');
  });

  it('guides migration for legacy non-UTC created_at evidence', () => {
    expect(runMutatedReadyLedger((ledger) => (ledger.created_at = '2026-08-05T19:34:18+09:00'))).toContain(
      'migrate legacy completion evidence to canonical issue_progress',
    );
  });

  it.each([
    ['missing source key', (ledger: LaneLedgerFixture) => Reflect.deleteProperty(ledger.source, 'search_ledger')],
    ['extra source key', (ledger: LaneLedgerFixture) => Object.assign(ledger.source, { artifact: null })],
    ['unknown source type', (ledger: LaneLedgerFixture) => Object.assign(ledger.source, { type: 'issues' })],
  ])('rejects %s', (_name, mutate) => {
    expect(runMutatedReadyLedger(mutate)).toContain('source must match a canonical source variant');
  });

  it('accepts canonical search-issue source', () => {
    expect(
      runMutatedReadyLedger((ledger) => {
        ledger.source = {
          type: 'search-issue',
          search_run_id: 'search-2026-08-18',
          search_ledger: '.sisyphus/search-issue/search-2026-08-18.json',
        };
      }, runValidatorPath),
    ).toContain('Lane ledger check passed for 1 file(s).');
  });

  it.each([
    ['empty lanes', (ledger: LaneLedgerFixture) => Object.assign(ledger, { lanes: [] })],
    ['empty queue', (ledger: LaneLedgerFixture) => (ledger.lanes[0].queue = [])],
    ['unknown lane key', (ledger: LaneLedgerFixture) => Object.assign(ledger.lanes[0], { legacy: true })],
    ['unsafe retry count', (ledger: LaneLedgerFixture) => (ledger.lanes[0].retry_count = -1)],
  ])('rejects %s', (_name, mutate) => {
    expect(runMutatedReadyLedger(mutate)).toContain('lane');
  });

  it.each(['status', 'sha'])('rejects root_main_sync missing %s', (field) => {
    expect(
      runMutatedCompletedLedger((ledger) => Reflect.deleteProperty(ledger.root_main_sync ?? {}, field)),
    ).toContain('root_main_sync must contain exactly status/sha');
  });

  it('rejects unknown root_main_sync evidence', () => {
    expect(runMutatedCompletedLedger((ledger) => Object.assign(ledger.root_main_sync ?? {}, { legacy: true }))).toContain(
      'root_main_sync must contain exactly status/sha',
    );
  });

  it('accepts a strict ready ledger from an arbitrary filesystem path', () => {
    expect(runMutatedReadyLedger(() => undefined, runValidatorPath)).toContain('Lane ledger check passed for 1 file(s).');
  });
});
