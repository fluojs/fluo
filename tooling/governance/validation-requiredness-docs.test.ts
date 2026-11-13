import { readFileSync } from 'node:fs';
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

    it(`${chapterPath}: removing the IsDefined import rejects the example`, () => {
      const chapter = readText(chapterPath).replace('IsBoolean, IsDefined,', 'IsBoolean,');

      const enforce = () => enforceValidationRequirednessDocs(
        (path) => path === chapterPath ? chapter : readText(path),
      );

      expect(enforce).toThrow('CreatePostDto must import IsDefined');
    });

    it(`${parityPath}: a stale validation major rejects the claim`, () => {
      const major = Number(JSON.parse(readText('packages/validation/package.json')).version.split('.')[0]);
      const parity = readText(parityPath).replace(
        '`@fluojs/validation`',
        `\`@fluojs/validation\` stable \`${major + 1}.x\``,
      );

      const enforce = () => enforceValidationRequirednessDocs(
        (path) => path === parityPath ? parity : readText(path),
      );

      expect(enforce).toThrow(`disagrees with package major ${major}.x`);
    });

    it(`${parityPath}: a matching validation major passes the claim`, () => {
      const major = JSON.parse(readText('packages/validation/package.json')).version.split('.')[0];
      const parity = readText(parityPath).replace(
        '`@fluojs/validation`',
        `\`@fluojs/validation\` stable \`${major}.x\``,
      );

      const enforce = () => enforceValidationRequirednessDocs(
        (path) => path === parityPath ? parity : readText(path),
      );

      expect(enforce).not.toThrow();
    });
  }
});
