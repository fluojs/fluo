import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATION_TRANSFORMS, runNestJsMigration } from './nestjs-migrate.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture(source: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'fluo-migrate-mapped-types-'));
  temporaryDirectories.push(directory);
  const filePath = join(directory, 'users.ts');
  writeFileSync(filePath, source);
  return filePath;
}

describe('runNestJsMigration mapped-type imports', () => {
  it('moves only mapped bindings into the canonical subpath and preserves aliases and type imports', () => {
    const filePath = createFixture(`
      import { PickType as NestPick } from '@fluojs/validation/mapped-types';
      import { OmitType as NestOmit, PartialType as NestPartial, PickType as NestPick } from '@nestjs/mapped-types';
      import { ApiProperty, IntersectionType as SwaggerIntersection, type OmitType as SwaggerOmit } from '@nestjs/swagger';

      void [NestOmit, NestPartial, NestPick, SwaggerIntersection];
      type SwaggerOmitType = typeof SwaggerOmit;
      void ({} as SwaggerOmitType);
      void ApiProperty;
    `);

    const firstReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: filePath,
    });
    const migrated = readFileSync(filePath, 'utf8');

    expect(firstReport.changedFiles).toBe(1);
    expect(migrated).not.toContain('@nestjs/mapped-types');
    expect(migrated).toMatch(/import \{ ApiProperty \} from ['"]@nestjs\/swagger['"];/u);
    expect(migrated).toMatch(/from ['"]@fluojs\/validation\/mapped-types['"];/u);
    expect(migrated).toContain('OmitType as NestOmit');
    expect(migrated).toContain('PartialType as NestPartial');
    expect(migrated).toContain('PickType as NestPick');
    expect(migrated).toContain('IntersectionType as SwaggerIntersection');
    expect(migrated).toContain('type OmitType as SwaggerOmit');
    expect([...migrated.matchAll(/PickType as NestPick/gu)]).toHaveLength(1);

    const secondReport = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: filePath,
    });

    expect(secondReport.changedFiles).toBe(0);
  });

  it('leaves unsupported mapped-type import forms untouched and warns for manual review', () => {
    const filePath = createFixture(`
      import * as MappedTypes from '@nestjs/mapped-types';

      void MappedTypes.PartialType;
    `);

    const report = runNestJsMigration({
      apply: true,
      enabledTransforms: new Set(MIGRATION_TRANSFORMS),
      targetPath: filePath,
    });

    expect(report.changedFiles).toBe(0);
    expect(report.fileResults.flatMap((result) => result.warnings)).toEqual([
      expect.objectContaining({ category: 'import-unsupported', filePath }),
    ]);
    expect(readFileSync(filePath, 'utf8')).toContain("import * as MappedTypes from '@nestjs/mapped-types';");
  });
});
