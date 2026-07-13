import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS i18n migration documentation', () => {
  it('maps NestJS i18n to the public fluo locale and validation APIs in both locales', () => {
    // Given
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');
    const httpSource = read('packages/i18n/src/http.ts');
    const validationSource = read('packages/i18n/src/validation.ts');
    const packageManifest = read('packages/i18n/package.json');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    expect(packageManifest).toContain('"./http"');
    expect(packageManifest).toContain('"./validation"');
    expect(httpSource).toContain('export function resolveHttpLocale(');
    expect(httpSource).toContain('export function getHttpLocale(');
    expect(validationSource).toContain('export function localizeDtoValidationError(');

    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain('I18nModule.forRoot(...)');
      expect(migrationDoc).toContain('resolveHttpLocale(...)');
      expect(migrationDoc).toContain('getHttpLocale(...)');
      expect(migrationDoc).toContain('localizeDtoValidationError(...)');
      expect(migrationDoc).toContain('@fluojs/i18n/http');
      expect(migrationDoc).toContain('@fluojs/i18n/validation');
    }
  });

  it('passes the resolved request locale explicitly into validation localization', () => {
    // Given
    const englishMigration = read('docs/getting-started/migrate-from-nestjs.md');
    const koreanMigration = read('docs/getting-started/migrate-from-nestjs.ko.md');

    // When
    const migrationDocs = [englishMigration, koreanMigration] as const;

    // Then
    for (const migrationDoc of migrationDocs) {
      expect(migrationDoc).toContain("const locale = getHttpLocale(context)?.locale ?? 'en';");
      expect(migrationDoc).toContain('localizeDtoValidationError(i18n, error, { locale })');
    }

    expect(englishMigration).toContain('does not read request state or a global locale implicitly');
    expect(koreanMigration).toContain('request state나 global locale을 암묵적으로 읽지 않는다');
  });

  it('keeps the explicit migration path discoverable from both context indexes', () => {
    // Given
    const englishContext = read('docs/CONTEXT.md');
    const koreanContext = read('docs/CONTEXT.ko.md');

    // When
    const contextDocs = [englishContext, koreanContext] as const;

    // Then
    for (const contextDoc of contextDocs) {
      expect(contextDoc).toContain('resolveHttpLocale(...)');
      expect(contextDoc).toContain('getHttpLocale(...)');
      expect(contextDoc).toContain('localizeDtoValidationError(...)');
    }
  });
});
