import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const createLaneRunner = resolve(
  repositoryRoot,
  '.agents/skills/create-lane/scripts/fixtures/run-scenario.mjs',
);
const createLaneFixture = resolve(
  repositoryRoot,
  'tooling/governance/fixtures/create-lane-native/valid-native-artifact.json',
);
const ledgerRelativePath = '.omo/lanes/lane-4101-runtime.json';
const artifactRelativePath =
  '.omo/search-issue/artifacts/search-native-runtime.json';
const receiptRelativePaths = [
  '.omo/approvals/approval-lane-4101-runtime-confirmed-issues.json',
  '.omo/approvals/approval-lane-4101-runtime-suggested-additions.json',
  '.omo/approvals/approval-lane-4101-runtime-lane-plan.json',
];
const temporaryRoots: string[] = [];

const { loadState } = (await import(
  resolve(
    repositoryRoot,
    '.agents/skills/execute-lane/scripts/state-store.mjs',
  )
)) as {
  loadState: (
    stateDirectory: string,
    ledgerPath: string,
    root?: string,
  ) => Readonly<Record<string, unknown>>;
};
const { acquireLease } = (await import(
  resolve(
    repositoryRoot,
    '.agents/skills/execute-lane/scripts/lane-lease.mjs',
  )
)) as {
  acquireLease: (
    stateDirectory: string,
    laneId: string,
  ) => Readonly<Record<string, unknown>>;
};

const isRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (path: string): Readonly<Record<string, unknown>> => {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) {
    throw new TypeError(`Expected a JSON object at ${path}.`);
  }
  return Object.fromEntries(Object.entries(parsed));
};

const writeRecord = (
  path: string,
  value: Readonly<Record<string, unknown>>,
): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const createProducerOutput = (): Readonly<{
  root: string;
  ledgerPath: string;
  artifactPath: string;
  receiptPaths: readonly string[];
  stateDirectory: string;
}> => {
  const root = mkdtempSync(resolve(tmpdir(), 'fluo-lane-handoff-'));
  temporaryRoots.push(root);
  execFileSync(
    process.execPath,
    [
      createLaneRunner,
      '--fixture-only',
      '--scenario',
      createLaneFixture,
      '--out',
      root,
    ],
    { encoding: 'utf8' },
  );
  const fixture = parseRecord(createLaneFixture);
  const artifacts = fixture['artifacts'];
  if (!isRecord(artifacts)) {
    throw new TypeError('Create-lane fixture must contain artifacts.');
  }
  const artifact = artifacts[artifactRelativePath];
  if (!isRecord(artifact)) {
    throw new TypeError('Create-lane fixture must contain the source artifact.');
  }
  const artifactPath = resolve(root, artifactRelativePath);
  writeRecord(artifactPath, Object.fromEntries(Object.entries(artifact)));
  const stateDirectory = resolve(
    root,
    '.omo/lane-runs/lane-4101-runtime',
  );
  mkdirSync(stateDirectory, { recursive: true });
  return {
    root,
    ledgerPath: resolve(root, ledgerRelativePath),
    artifactPath,
    receiptPaths: receiptRelativePaths.map((path) => resolve(root, path)),
    stateDirectory,
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('$execute-lane canonical handoff boundary', () => {
  it('accepts the exact normal-lane producer output', () => {
    // Given
    const handoff = createProducerOutput();

    // When
    const state = loadState(
      handoff.stateDirectory,
      handoff.ledgerPath,
      handoff.root,
    );

    // Then
    expect(state['snapshot']).toEqual(parseRecord(handoff.ledgerPath));
  });

  it('rejects a valid ledger outside the canonical lane path', () => {
    // Given
    const handoff = createProducerOutput();
    const noncanonicalPath = resolve(handoff.root, 'lane.json');
    const rejectedStateDirectory = resolve(
      handoff.root,
      '.omo/lane-runs/rejected',
    );
    copyFileSync(handoff.ledgerPath, noncanonicalPath);

    // When / Then
    expect(() =>
      loadState(rejectedStateDirectory, noncanonicalPath, handoff.root),
    ).toThrow(/canonical lane path/u);
    expect(existsSync(rejectedStateDirectory)).toBe(false);
  });

  it('rejects a normal lane whose source artifact was changed', () => {
    // Given
    const handoff = createProducerOutput();
    writeRecord(handoff.artifactPath, {
      ...parseRecord(handoff.artifactPath),
      selected_issues: [9999],
    });

    // When / Then
    expect(() =>
      loadState(
        handoff.stateDirectory,
        handoff.ledgerPath,
        handoff.root,
      ),
    ).toThrow();
  });

  it.each(receiptRelativePaths)(
    'rejects a normal lane whose %s receipt was changed',
    (receiptRelativePath) => {
      // Given
      const handoff = createProducerOutput();
      const receiptPath = resolve(handoff.root, receiptRelativePath);
      writeRecord(receiptPath, {
        ...parseRecord(receiptPath),
        binding_sha256: '0'.repeat(64),
      });

      // When / Then
      expect(() =>
        loadState(
          handoff.stateDirectory,
          handoff.ledgerPath,
          handoff.root,
        ),
      ).toThrow(/approval binding/u);
    },
  );

  it('accepts a resumed snapshot with reordered immutable object keys', () => {
    // Given
    const handoff = createProducerOutput();
    const ledger = parseRecord(handoff.ledgerPath);
    const authority = ledger['authority_scope'];
    if (!isRecord(authority)) {
      throw new TypeError('Lane ledger must contain authority_scope.');
    }
    writeRecord(resolve(handoff.stateDirectory, 'snapshot.json'), {
      ...ledger,
      authority_scope: Object.fromEntries(
        Object.entries(authority).reverse(),
      ),
    });

    // When / Then
    expect(() =>
      loadState(
        handoff.stateDirectory,
        handoff.ledgerPath,
        handoff.root,
      ),
    ).not.toThrow();
  });

  it('rejects a resumed snapshot with a changed immutable authority', () => {
    // Given
    const handoff = createProducerOutput();
    const ledger = parseRecord(handoff.ledgerPath);
    const authority = ledger['authority_scope'];
    if (!isRecord(authority)) {
      throw new TypeError('Lane ledger must contain authority_scope.');
    }
    writeRecord(resolve(handoff.stateDirectory, 'snapshot.json'), {
      ...ledger,
      authority_scope: {
        ...authority,
        cleanup_command_worktrees: false,
      },
    });

    // When / Then
    expect(() =>
      loadState(
        handoff.stateDirectory,
        handoff.ledgerPath,
        handoff.root,
      ),
    ).toThrow(/immutable plan/u);
  });

  it('removes the lock when lease initialization fails', () => {
    // Given
    const stateDirectory = mkdtempSync(
      resolve(tmpdir(), 'fluo-lane-lease-'),
    );
    temporaryRoots.push(stateDirectory);
    mkdirSync(resolve(stateDirectory, 'lease.json'));

    // When / Then
    expect(() =>
      acquireLease(stateDirectory, 'lane-4101-runtime'),
    ).toThrow();
    expect(existsSync(resolve(stateDirectory, 'lease.lock'))).toBe(false);
  });
});
