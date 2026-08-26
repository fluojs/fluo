import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fixtureRoot = resolve(
  root,
  'tooling/governance/fixtures/execute-lane-native',
);
const replayCli = resolve(
  root,
  '.agents/skills/execute-lane/scripts/fixtures/run-replay.mjs',
);
const ledgerVerifier = resolve(
  root,
  'tooling/governance/verify-lane-ledger.mjs',
);
const initialLedger = resolve(fixtureRoot, 'ready-ledger-v2.json');

const parseRecord = (value: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new TypeError('Expected a JSON object.');
  }
  return Object.fromEntries(Object.entries(parsed));
};

const runScenario = (
  fixtureName: string,
  stateDirectory: string,
): Readonly<Record<string, unknown>> =>
  parseRecord(
    execFileSync(
      process.execPath,
      [
        replayCli,
        '--fixture-only',
        '--scenario',
        resolve(fixtureRoot, `${fixtureName}.json`),
        '--ledger',
        initialLedger,
        '--state-dir',
        stateDirectory,
      ],
      { encoding: 'utf8' },
    ),
  );

const eventLines = (stateDirectory: string): readonly string[] =>
  readFileSync(resolve(stateDirectory, 'events.jsonl'), 'utf8')
    .trim()
    .split('\n');

describe('$execute-lane persisted files', () => {
  it('persists a validator-clean snapshot, events, receipts, and released lease', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-lane-'));
    try {
      runScenario('happy', state);
      expect(
        execFileSync(
          process.execPath,
          [ledgerVerifier, resolve(state, 'snapshot.json')],
          { encoding: 'utf8' },
        ),
      ).toContain('Lane ledger check passed for 1 file(s).');
      expect(eventLines(state).length).toBeGreaterThan(3);
      const receipts: unknown = JSON.parse(
        readFileSync(resolve(state, 'receipts.json'), 'utf8'),
      );
      expect(receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            side_effect: 'pr.merge',
            target: {
              kind: 'pull-request',
              id: '5101',
              url: 'https://github.com/fluojs/fluo/pull/5101',
            },
          }),
        ]),
      );
      expect(
        parseRecord(readFileSync(resolve(state, 'lease.json'), 'utf8'))[
          'status'
        ],
      ).toBe('released');
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('resumes a snapshot without rewriting the existing event prefix', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-lane-'));
    try {
      const interrupted = runScenario('interrupted-start', state);
      const existingEvents = eventLines(state);
      expect(interrupted['status']).toBe('running');

      const resumed = runScenario('interrupted-resume', state);
      const resumedEvents = eventLines(state);
      expect(resumed['status']).toBe('done');
      expect(resumedEvents.slice(0, existingEvents.length)).toEqual(
        existingEvents,
      );
      expect(resumedEvents.length).toBeGreaterThan(existingEvents.length);
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });

  it('recovers a transaction after events append but before snapshot replacement', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-lane-'));
    const expectedState = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-expected-'),
    );
    try {
      runScenario('interrupted-start', state);
      cpSync(state, expectedState, { recursive: true });
      runScenario('interrupted-resume', expectedState);

      const expectedEvents = eventLines(expectedState);
      const currentEvents = eventLines(state);
      const missingEvents = expectedEvents.slice(currentEvents.length);
      const firstMissing = missingEvents[0];
      if (firstMissing === undefined) {
        throw new TypeError('Expected a transition event to recover.');
      }
      appendFileSync(resolve(state, 'events.jsonl'), `${firstMissing}\n`, 'utf8');
      writeFileSync(
        resolve(state, 'transaction.json'),
        `${JSON.stringify(
          {
            version: 1,
            snapshot: JSON.parse(
              readFileSync(resolve(expectedState, 'snapshot.json'), 'utf8'),
            ),
            events: expectedEvents.map((line) => JSON.parse(line)),
            receipts: JSON.parse(
              readFileSync(resolve(expectedState, 'receipts.json'), 'utf8'),
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const recovered = runScenario('interrupted-resume', state);
      expect(recovered['status']).toBe('done');
      expect(eventLines(state)).toEqual(expectedEvents);
      expect(
        readFileSync(resolve(state, 'snapshot.json'), 'utf8'),
      ).toBe(readFileSync(resolve(expectedState, 'snapshot.json'), 'utf8'));
      expect(existsSync(resolve(state, 'transaction.json'))).toBe(false);
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(expectedState, { recursive: true, force: true });
    }
  });

  it('recovers a transaction over a torn trailing event write', () => {
    const state = mkdtempSync(resolve(tmpdir(), 'fluo-execute-torn-'));
    const expectedState = mkdtempSync(
      resolve(tmpdir(), 'fluo-execute-torn-expected-'),
    );
    try {
      runScenario('interrupted-start', state);
      cpSync(state, expectedState, { recursive: true });
      runScenario('interrupted-resume', expectedState);

      const expectedEvents = eventLines(expectedState);
      const currentEvents = eventLines(state);
      const firstMissing = expectedEvents[currentEvents.length];
      if (firstMissing === undefined) {
        throw new TypeError('Expected a transition event to tear.');
      }
      appendFileSync(
        resolve(state, 'events.jsonl'),
        firstMissing.slice(0, Math.max(1, firstMissing.length / 2)),
        'utf8',
      );
      writeFileSync(
        resolve(state, 'transaction.json'),
        `${JSON.stringify(
          {
            version: 1,
            snapshot: JSON.parse(
              readFileSync(resolve(expectedState, 'snapshot.json'), 'utf8'),
            ),
            events: expectedEvents.map((line) => JSON.parse(line)),
            receipts: JSON.parse(
              readFileSync(resolve(expectedState, 'receipts.json'), 'utf8'),
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );

      const recovered = runScenario('interrupted-resume', state);
      expect(recovered['status']).toBe('done');
      expect(eventLines(state)).toEqual(expectedEvents);
      expect(existsSync(resolve(state, 'transaction.json'))).toBe(false);
    } finally {
      rmSync(state, { recursive: true, force: true });
      rmSync(expectedState, { recursive: true, force: true });
    }
  });
});
