import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const sourceDirectory = resolve(root, '.opencode-backup/search-issue');
const trackedReceiptPath = resolve(sourceDirectory, 'migration-receipt.json');
const importerPath = resolve(
  root,
  '.agents/skills/search-issue/scripts/migrate-legacy-artifacts.mjs',
);

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

const runImporter = (
  source: string,
  target: string,
): Readonly<Record<string, unknown>> =>
  parseRecord(
    execFileSync(
      process.execPath,
      [
        importerPath,
        '--source',
        source,
        '--target',
        target,
        '--migrated-at',
        '2026-08-24T00:00:00.000Z',
      ],
      { encoding: 'utf8' },
    ),
  );

describe('legacy search artifact migration', () => {
  it('reconstructs nine canonical v2 artifacts and the committed checksum receipt', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-search-migration-'));
    const target = resolve(
      outputRoot,
      '.omo/search-issue/artifacts/legacy',
    );

    try {
      // When
      const first = runImporter(sourceDirectory, target);
      const second = runImporter(sourceDirectory, target);

      // Then
      expect(first).toEqual(second);
      expect(first).toEqual({
        status: 'migrated',
        artifact_count: 9,
        receipt: '.omo/search-issue/artifacts/legacy/migration-receipt.json',
      });
      expect(readdirSync(target).sort()).toHaveLength(10);
      expect(
        parseRecord(readFileSync(resolve(target, 'migration-receipt.json'), 'utf8')),
      ).toEqual(parseRecord(readFileSync(trackedReceiptPath, 'utf8')));
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when an existing migrated artifact has different bytes', () => {
    // Given
    const outputRoot = mkdtempSync(resolve(tmpdir(), 'fluo-search-migration-'));
    const source = resolve(outputRoot, 'source');
    const target = resolve(outputRoot, 'target');
    cpSync(sourceDirectory, source, { recursive: true });
    runImporter(source, target);
    const firstArtifact = readdirSync(target)
      .filter((name) => name !== 'migration-receipt.json')
      .sort()[0];
    if (firstArtifact === undefined) {
      throw new TypeError('Expected one migrated artifact.');
    }
    writeFileSync(resolve(target, firstArtifact), '{"tampered":true}\n', 'utf8');

    try {
      // When / Then
      expect(() => runImporter(source, target)).toThrow();
      expect(readFileSync(resolve(target, firstArtifact), 'utf8')).toBe(
        '{"tampered":true}\n',
      );
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
