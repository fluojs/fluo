import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceValidationRequirednessDocs } from './validation-requiredness-docs.mjs';

function readText(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('validation requiredness documentation governance', () => {
  it('governed EN/KO docs: required strings and version-agnostic stability pass', () => {
    expect(() => enforceValidationRequirednessDocs()).not.toThrow();
  });

  for (const locale of ['', '.ko']) {
    const chapterPath = `book/beginner/ch06-validation${locale}.md`;
    const parityPath = `docs/contracts/nestjs-parity-gaps${locale}.md`;

    for (const [path, heading] of [
      [chapterPath, '## 6.2 Defining CreatePostDto with Validation Rules'],
      [parityPath, '## Not Implemented'],
    ]) {
      it.each([
        ['missing', ''],
        ['duplicated', `${heading}\n${heading}`],
        ['commented-out', `<!-- ${heading} -->`],
      ])(`${path}: %s section heading rejects the documentation`, (_, replacement) => {
        const changed = readText(path).replace(heading, replacement);

        const enforce = () => enforceValidationRequirednessDocs(
          (candidate) => candidate === path ? changed : readText(candidate),
        );

        expect(enforce).toThrow(`${heading} must appear exactly once`);
      });
    }

    it.each([
      [chapterPath, '@IsDefined()', '', 'CreatePostDto.title must use @IsDefined()'],
      [
        parityPath,
        locale === ''
          ? '`@fluojs/validation` follows that Official-tier stability contract.'
          : '`@fluojs/validation`은 이 Official tier 안정성 계약을 따릅니다.',
        '`@fluojs/validation` stable `999.x`',
        'stability row must match the canonical line exactly once',
      ],
    ])('canonical verifier: invalid %s -> rejects the documentation', (path, before, after, message) => {
      const preload = `
        import fs from 'node:fs';
        import { syncBuiltinESMExports } from 'node:module';
        const originalReadFileSync = fs.readFileSync;
        fs.readFileSync = function (file, ...args) {
          const content = originalReadFileSync.call(this, file, ...args);
          return String(file).endsWith(${JSON.stringify(path)}) && typeof content === 'string'
            ? content.replace(${JSON.stringify(before)}, ${JSON.stringify(after)})
            : content;
        };
        syncBuiltinESMExports();
      `;

      const result = spawnSync(process.execPath, [
        '--import',
        `data:text/javascript,${encodeURIComponent(preload)}`,
        fileURLToPath(new URL('./verify-platform-consistency-governance.mjs', import.meta.url)),
      ], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        encoding: 'utf8',
        timeout: 30_000,
      });

      expect(result.stderr).toContain(message);
      expect(result.status).toBe(1);
    });

    it.each(['title', 'body'])(
      `${chapterPath}: removing IsDefined from %s rejects the example`,
      (field) => {
        const chapter = readText(chapterPath).replace(
          new RegExp(String.raw`@IsDefined\(\)\n(\s*@IsString\(\)\n\s*@MinLength\(\d+\)\n\s*${field})`, 'u'),
          '$1',
        );

        const enforce = () => enforceValidationRequirednessDocs(
          (path) => path === chapterPath ? chapter : readText(path),
        );

        expect(enforce).toThrow(`CreatePostDto.${field} must use @IsDefined()`);
      },
    );

    for (const field of ['title', 'body']) {
      it.each([
        ['commented-out', '// @IsDefined()'],
        ['block-commented', '/* @IsDefined() */'],
        ['duplicated', '@IsDefined()\n  @IsDefined()'],
        ['negated-prefix', '!@IsDefined()'],
        ['reworded', '@IsDefined({})'],
      ])(`${chapterPath}: %s IsDefined on ${field} rejects the example`, (_, replacement) => {
        const chapter = readText(chapterPath).replace(
          new RegExp(String.raw`@IsDefined\(\)(\n\s*@IsString\(\)\n\s*@MinLength\(\d+\)\n\s*${field})`, 'u'),
          `${replacement}$1`,
        );

        const enforce = () => enforceValidationRequirednessDocs(
          (path) => path === chapterPath ? chapter : readText(path),
        );

        expect(enforce).toThrow(`CreatePostDto.${field} must use @IsDefined()`);
      });
    }

    it(`${chapterPath}: removing the IsDefined import rejects the example`, () => {
      const chapter = readText(chapterPath).replace('IsBoolean, IsDefined,', 'IsBoolean,');

      const enforce = () => enforceValidationRequirednessDocs(
        (path) => path === chapterPath ? chapter : readText(path),
      );

      expect(enforce).toThrow('CreatePostDto must import IsDefined');
    });

    const parity = readText(parityPath);
    const stabilityRow = parity.split('\n').find((line) => line.includes('| `docs/contracts/release-governance.md`'));
    if (!stabilityRow) {
      throw new Error(`${parityPath}: stability fixture is missing`);
    }
    const stabilitySentence = locale === ''
      ? '`@fluojs/validation` follows that Official-tier stability contract.'
      : '`@fluojs/validation`은 이 Official tier 안정성 계약을 따릅니다.';
    const reordered = locale === ''
      ? 'The current stable `1.x` package, `@fluojs/validation`, follows that stability contract.'
      : '현재 stable `1.x` 패키지인 `@fluojs/validation`은 이 안정성 계약을 따릅니다.';

    it.each([
      ['missing', ''],
      ['duplicated', `${stabilityRow}\n${stabilityRow}`],
      ['negated-prefix', `${locale === '' ? 'Not true: ' : '사실이 아님: '}${stabilityRow}`],
      ['reordered', stabilityRow.replace(stabilitySentence, reordered)],
      ['commented-out', `<!-- ${stabilityRow} -->`],
      ['stale-major', stabilityRow.replace('`@fluojs/validation`', '`@fluojs/validation` stable `999.x`')],
      ['matching-major', stabilityRow.replace('`@fluojs/validation`', '`@fluojs/validation` stable `2.x`')],
      ['additional-claim', `${stabilityRow}\n${reordered}`],
    ])(`${parityPath}: %s stability claim rejects the documentation`, (_, replacement) => {
      const changed = parity.replace(stabilityRow, replacement);

      const enforce = () => enforceValidationRequirednessDocs(
        (path) => path === parityPath ? changed : readText(path),
      );

      expect(enforce).toThrow('stability row must match the canonical line exactly once');
    });
  }
});
